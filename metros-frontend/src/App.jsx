// app.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';

// Ключи для VKStorage
const STORAGE_KEYS = {
  USER_ID: 'metro_user_id',
  NICKNAME: 'metro_nickname',
  CITY: 'metro_city',
  GENDER: 'metro_gender',
  CLOTHING_COLOR: 'metro_clothing_color',
  WAGON_NUMBER: 'metro_wagon_number',
  SELECTED_STATION: 'metro_selected_station',
  CURRENT_SCREEN: 'metro_current_screen',
  POSITION: 'metro_position',
  MOOD: 'metro_mood',
  DEVICE_ID: 'metro_device_id',
  SESSION_ID: 'metro_session_id'
};

// Быстрый кэш в памяти
let storageCache = {};
let usersCache = null;
let usersCacheTime = 0;
const USERS_CACHE_TTL = 2000; // 2 секунды

// Быстрая загрузка из VKStorage
const loadFromVKStorage = async (keys) => {
  try {
    const result = await bridge.send('VKWebAppStorageGet', { keys });
    const data = {};
    
    for (const item of result.keys) {
      if (item.value) {
        try {
          data[item.key] = JSON.parse(item.value);
        } catch {
          data[item.key] = item.value;
        }
      }
    }
    
    storageCache = { ...storageCache, ...data };
    return data;
  } catch {
    const data = {};
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (value) {
        try {
          data[key] = JSON.parse(value);
        } catch {
          data[key] = value;
        }
      }
    }
    storageCache = { ...storageCache, ...data };
    return data;
  }
};

// Быстрое сохранение
const saveToVKStorage = async (key, value) => {
  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    await bridge.send('VKWebAppStorageSet', { key, value: stringValue });
    storageCache[key] = value;
  } catch {
    localStorage.setItem(key, stringValue);
    storageCache[key] = value;
  }
};

// Массовое сохранение
const saveMultipleToStorage = async (data) => {
  const promises = [];
  for (const [key, value] of Object.entries(data)) {
    promises.push(saveToVKStorage(key, value));
  }
  await Promise.all(promises);
};

// Генерация deviceId (синхронно)
const generateDeviceId = () => {
  let deviceId = storageCache[STORAGE_KEYS.DEVICE_ID] || localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  
  if (!deviceId) {
    deviceId = `metro_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    setTimeout(() => saveToVKStorage(STORAGE_KEYS.DEVICE_ID, deviceId), 100);
  }
  
  return deviceId;
};

// Генерация сессии
const generateSessionId = (deviceId) => `s_${deviceId}_${Date.now()}`;

// Оптимизированный поиск пользователя (O(n) но с ранним выходом)
const findUserByDeviceId = (users, deviceId) => {
  for (let i = 0; i < users.length; i++) {
    if (users[i].device_id === deviceId) {
      return users[i];
    }
  }
  return null;
};

export const App = () => {
  // Состояния с мгновенной загрузкой из кэша
  const [currentScreen, setCurrentScreen] = useState(() => {
    return storageCache[STORAGE_KEYS.CURRENT_SCREEN] || 'setup';
  });
  
  const [selectedCity, setSelectedCity] = useState(() => {
    return storageCache[STORAGE_KEYS.CITY] || 'spb';
  });
  
  const [selectedGender, setSelectedGender] = useState(() => {
    return storageCache[STORAGE_KEYS.GENDER] || 'male';
  });
  
  const [selectedPosition, setSelectedPosition] = useState(() => {
    return storageCache[STORAGE_KEYS.POSITION] || '';
  });
  
  const [selectedMood, setSelectedMood] = useState(() => {
    return storageCache[STORAGE_KEYS.MOOD] || '';
  });
  
  const [wagonNumber, setWagonNumber] = useState(() => {
    return storageCache[STORAGE_KEYS.WAGON_NUMBER] || '';
  });
  
  const [clothingColor, setClothingColor] = useState(() => {
    return storageCache[STORAGE_KEYS.CLOTHING_COLOR] || '';
  });
  
  const [nickname, setNickname] = useState(() => {
    return storageCache[STORAGE_KEYS.NICKNAME] || '';
  });
  
  const [currentSelectedStation, setCurrentSelectedStation] = useState(() => {
    return storageCache[STORAGE_KEYS.SELECTED_STATION] || null;
  });
  
  const [currentGroup, setCurrentGroup] = useState(null);
  const [stationsData, setStationsData] = useState({ 
    stationStats: [], 
    totalStats: { total_connected: 0, total_waiting: 0, total_users: 0 } 
  });
  const [groupMembers, setGroupMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [deviceId, setDeviceId] = useState('');
  const [errors, setErrors] = useState({});

  // Refs
  const userIdRef = useRef(null);
  const sessionIdRef = useRef('');
  const vkUserIdRef = useRef(null);
  const pendingUpdatesRef = useRef({});
  const updateTimeoutRef = useRef(null);
  const loadAttemptsRef = useRef(0);

  // ==================== БЫСТРАЯ ИНИЦИАЛИЗАЦИЯ ====================
  useEffect(() => {
    const init = async () => {
      try {
        // Загружаем все ключи одним запросом
        const keys = Object.values(STORAGE_KEYS);
        const data = await loadFromVKStorage(keys);
        
        // Применяем все значения
        if (data[STORAGE_KEYS.USER_ID]) userIdRef.current = data[STORAGE_KEYS.USER_ID];
        if (data[STORAGE_KEYS.SESSION_ID]) sessionIdRef.current = data[STORAGE_KEYS.SESSION_ID];
        
        // Получаем VK пользователя (параллельно)
        bridge.send('VKWebAppGetUserInfo').then(user => {
          vkUserIdRef.current = user.id;
        }).catch(() => {});
        
        // Загружаем статистику сразу
        loadStationsMap(true);
        
        // Если были на экране joined, восстанавливаем
        if (data[STORAGE_KEYS.CURRENT_SCREEN] === 'joined' && data[STORAGE_KEYS.SELECTED_STATION]) {
          setCurrentGroup({ station: data[STORAGE_KEYS.SELECTED_STATION], users: [] });
          setTimeout(() => loadGroupMembers(data[STORAGE_KEYS.SELECTED_STATION]), 100);
        }
      } catch (error) {
        console.warn('Init error:', error);
      }
    };
    
    // Генерируем deviceId
    setDeviceId(generateDeviceId());
    
    // Инициализация VK
    bridge.send("VKWebAppInit");
    
    // Подписка на тему
    bridge.subscribe((event) => {
      if (event.detail?.type === 'VKWebAppUpdateConfig') {
        const schemeAttribute = document.createAttribute('scheme');
        schemeAttribute.value = event.detail.data.scheme || 'client_light';
        document.body.attributes.setNamedItem(schemeAttribute);
      }
    });
    
    // Запускаем инициализацию
    init();
    
    // Онлайн/офлайн
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ==================== СОХРАНЕНИЕ (debounced) ====================
  useEffect(() => {
    if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
    
    updateTimeoutRef.current = setTimeout(() => {
      const updates = {
        [STORAGE_KEYS.NICKNAME]: nickname,
        [STORAGE_KEYS.CITY]: selectedCity,
        [STORAGE_KEYS.GENDER]: selectedGender,
        [STORAGE_KEYS.CLOTHING_COLOR]: clothingColor,
        [STORAGE_KEYS.WAGON_NUMBER]: wagonNumber,
        [STORAGE_KEYS.CURRENT_SCREEN]: currentScreen,
        [STORAGE_KEYS.POSITION]: selectedPosition,
        [STORAGE_KEYS.MOOD]: selectedMood,
        [STORAGE_KEYS.DEVICE_ID]: deviceId
      };
      
      if (currentSelectedStation) updates[STORAGE_KEYS.SELECTED_STATION] = currentSelectedStation;
      if (userIdRef.current) updates[STORAGE_KEYS.USER_ID] = userIdRef.current;
      if (sessionIdRef.current) updates[STORAGE_KEYS.SESSION_ID] = sessionIdRef.current;
      
      saveMultipleToStorage(updates);
    }, 300);
    
    return () => clearTimeout(updateTimeoutRef.current);
  }, [nickname, selectedCity, selectedGender, clothingColor, wagonNumber, currentScreen, selectedPosition, selectedMood, deviceId, currentSelectedStation]);

  // ==================== БЫСТРАЯ ЗАГРУЗКА СТАТИСТИКИ ====================
  const loadStationsMap = useCallback(async (force = false) => {
    try {
      const stats = await api.getStationsStats(selectedCity, force);
      if (stats) setStationsData(stats);
    } catch (error) {
      console.warn('Load stats error:', error);
    }
  }, [selectedCity]);

  // ==================== ЗАГРУЗКА УЧАСТНИКОВ ====================
  const loadGroupMembers = useCallback(async (station = null) => {
    const targetStation = station || currentGroup?.station;
    if (!targetStation) return;
    
    try {
      // Используем новый оптимизированный endpoint
      const users = await api.getStationUsers(targetStation);
      setGroupMembers(users);
    } catch (error) {
      console.warn('Load members error:', error);
    }
  }, [currentGroup]);

  // ==================== ВХОД В КОМНАТУ ОЖИДАНИЯ (МГНОВЕННЫЙ) ====================
  const handleEnterWaitingRoom = async () => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setErrors({ nickname: true });
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Введите никнейм' });
      return;
    }
    
    // МГНОВЕННО переключаем экран
    setCurrentScreen('waiting');
    setIsLoading(true);
    
    try {
      // Параллельные запросы
      const [users, stats] = await Promise.all([
        api.getUsers(),
        api.getStationsStats(selectedCity)
      ]);
      
      if (stats) setStationsData(stats);
      
      const existingUser = findUserByDeviceId(users, deviceId);
      const newSessionId = generateSessionId(deviceId);
      sessionIdRef.current = newSessionId;
      
      if (existingUser) {
        userIdRef.current = existingUser.id;
        // Обновляем в фоне
        api.updateUser(existingUser.id, {
          name: trimmedNickname,
          city: selectedCity,
          gender: selectedGender,
          session_id: newSessionId,
          online: true,
          is_waiting: true,
          is_connected: false,
          last_seen: new Date().toISOString()
        }).catch(() => {});
      } else {
        // Создаем нового
        const userData = {
          name: trimmedNickname,
          city: selectedCity,
          gender: selectedGender,
          session_id: newSessionId,
          device_id: deviceId,
          vk_user_id: vkUserIdRef.current,
          online: true,
          is_waiting: true,
          is_connected: false,
          last_seen: new Date().toISOString()
        };
        
        const createdUser = await api.createUser(userData);
        if (createdUser?.id) userIdRef.current = createdUser.id;
      }
      
      saveMultipleToStorage({
        [STORAGE_KEYS.USER_ID]: userIdRef.current,
        [STORAGE_KEYS.SESSION_ID]: newSessionId,
        [STORAGE_KEYS.NICKNAME]: trimmedNickname,
        [STORAGE_KEYS.CURRENT_SCREEN]: 'waiting'
      });
      
    } catch (error) {
      console.error('Registration error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // ==================== ПОДТВЕРЖДЕНИЕ СТАНЦИИ (МГНОВЕННЫЙ) ====================
  const handleConfirmStation = async () => {
    if (!clothingColor.trim()) {
      setErrors({ clothingColor: true });
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Укажите цвет одежды' });
      return;
    }
    
    if (!currentSelectedStation) {
      setErrors({ station: true });
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Выберите станцию' });
      return;
    }

    if (!userIdRef.current) {
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Сначала создайте профиль' });
      return;
    }

    // МГНОВЕННО обновляем UI
    setCurrentGroup({ station: currentSelectedStation, users: [] });
    setCurrentScreen('joined');
    setIsLoading(true);
    
    try {
      // Параллельные запросы
      const [updateResult, members] = await Promise.all([
        api.updateUser(userIdRef.current, {
          station: currentSelectedStation,
          wagon: wagonNumber,
          color: clothingColor.trim(),
          is_waiting: false,
          is_connected: true,
          online: true,
          last_seen: new Date().toISOString()
        }),
        api.getStationUsers(currentSelectedStation)
      ]);
      
      setGroupMembers(members);
      
      saveMultipleToStorage({
        [STORAGE_KEYS.CURRENT_SCREEN]: 'joined',
        [STORAGE_KEYS.SELECTED_STATION]: currentSelectedStation,
        [STORAGE_KEYS.CLOTHING_COLOR]: clothingColor.trim(),
        [STORAGE_KEYS.WAGON_NUMBER]: wagonNumber
      });
      
      // Обновляем статистику в фоне
      loadStationsMap(true);
      
    } catch (error) {
      console.error('Join error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // ==================== ВЫХОД ИЗ ГРУППЫ ====================
  const handleLeaveGroup = async () => {
    if (userIdRef.current) {
      api.updateUser(userIdRef.current, { 
        is_waiting: true,
        is_connected: false,
        station: '',
        last_seen: new Date().toISOString()
      }).catch(() => {});
    }
    
    setCurrentGroup(null);
    setCurrentScreen('waiting');
    setSelectedPosition('');
    setSelectedMood('');
    
    saveMultipleToStorage({
      [STORAGE_KEYS.CURRENT_SCREEN]: 'waiting',
      [STORAGE_KEYS.POSITION]: '',
      [STORAGE_KEYS.MOOD]: ''
    });
  };

  // ==================== ОБНОВЛЕНИЕ СОСТОЯНИЯ ====================
  const updateUserState = useCallback(async () => {
    if (!userIdRef.current) return;
    
    const status = selectedPosition && selectedMood 
      ? `${selectedPosition} | ${selectedMood}`
      : selectedPosition || selectedMood || 'Ожидание';
    
    // Локальное обновление
    setGroupMembers(prev => 
      prev.map(member => 
        member.id === userIdRef.current 
          ? { ...member, status, position: selectedPosition, mood: selectedMood }
          : member
      )
    );
    
    // Фоновое обновление
    api.updateUser(userIdRef.current, { 
      status,
      position: selectedPosition,
      mood: selectedMood,
      last_seen: new Date().toISOString()
    }).catch(() => {});
  }, [selectedPosition, selectedMood]);

  // Автообновление
  useEffect(() => {
    if (currentScreen === 'joined' && currentGroup) {
      loadGroupMembers(currentGroup.station);
      const interval = setInterval(() => loadGroupMembers(currentGroup.station), 10000);
      return () => clearInterval(interval);
    }
  }, [currentScreen, currentGroup, loadGroupMembers]);

  useEffect(() => {
    const timer = setTimeout(updateUserState, 300);
    return () => clearTimeout(timer);
  }, [selectedPosition, selectedMood, updateUserState]);

  useEffect(() => {
    if (currentScreen === 'waiting' || currentScreen === 'joined') {
      const interval = setInterval(() => loadStationsMap(), 15000);
      return () => clearInterval(interval);
    }
  }, [currentScreen, loadStationsMap]);

  // ==================== РЕНДЕР КАРТЫ ====================
  const renderStationsMap = () => {
    const { stationStats } = stationsData;
    const cityStations = helpers.stations[selectedCity] || [];
    
    return cityStations.map(stationName => {
      const stationData = stationStats.find(s => s.station === stationName);
      const isSelected = currentSelectedStation === stationName;
      
      return (
        <div 
          key={stationName}
          className={`station-map-item ${stationData?.connected ? 'connected' : stationData?.waiting ? 'waiting' : 'empty'} ${isSelected ? 'selected' : ''}`}
          onClick={() => {
            setCurrentSelectedStation(stationName);
            setErrors({ station: false });
          }}
        >
          <div className="station-name">{stationName}</div>
          <div className="station-counts">
            {stationData?.waiting > 0 && (
              <span className="count-waiting">{stationData.waiting}⏳</span>
            )}
            {stationData?.connected > 0 && (
              <span className="count-connected">{stationData.connected}✅</span>
            )}
          </div>
        </div>
      );
    });
  };

  // ==================== РЕНДЕР УЧАСТНИКОВ ====================
  const renderGroupMembers = () => {
    if (groupMembers.length === 0) {
      return <div className="no-requests">Нет участников на этой станции</div>;
    }
    
    return groupMembers.map(user => {
      const isCurrentUser = userIdRef.current && user.id === userIdRef.current;
      
      return (
        <div key={user.id} className={`user-state-display ${isCurrentUser ? 'current-user' : ''}`}>
          <div className="user-avatar" style={{background: user.color_code || '#007bff'}}>
            {user.name?.charAt(0) || '?'}
          </div>
          <div className="user-state-info">
            <div className="user-state-name">
              {user.name} {isCurrentUser && '(Вы)'}
            </div>
            <div className="user-state-details">
              {(user.position || user.mood) && (
                <div>
                  {user.position && <span className="state-highlight">{user.position}</span>}
                  {user.position && user.mood && ' • '}
                  {user.mood && <span className="state-highlight">{user.mood}</span>}
                </div>
              )}
              {user.color && (
                <div style={{marginTop: '4px', fontSize: '12px', color: '#666'}}>
                  🎨 {user.color}
                  {user.wagon && user.wagon !== '' && user.wagon !== 'Не указан' && (
                    <> • 🚇 Вагон {user.wagon}</>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    });
  };

  // ==================== ОСНОВНОЙ РЕНДЕР ====================
  return (
    <div className="app-container">
      {!isOnline && (
        <div className="offline-indicator">⚠️ Нет соединения</div>
      )}
      
      {isLoading && (
        <div className="loader-card">
          <div className="loader-1"><div className="neuromorphic-circle"></div></div>
          <div>Загрузка...</div>
        </div>
      )}
      
      <div className="container">
        <header>
          <div className="header-main">
            <div className="header-title">
              <h1>Метрос</h1>
              <div className="subtitle">Встречай попутчика🚉✔</div>
            </div>
            <div className="header-icons"><div className="metro-icon">🚇</div></div>
          </div>
        </header>
        
        <div className="content">
          {/* ЭКРАН НАСТРОЙКИ */}
          {currentScreen === 'setup' && (
            <div className="screen">
              <h2>Настройка профиля</h2>
              
              <div className="form-group">
                <label>Никнейм *</label>
                <input 
                  type="text" 
                  placeholder="Придумайте уникальное имя" 
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    setErrors({ nickname: false });
                  }}
                  className={errors.nickname ? 'error-input' : ''}
                />
              </div>
              
              <div className="form-group">
                <label>Город:</label>
                <div className="city-options">
                  <div className={`city-option moscow ${selectedCity === 'moscow' ? 'active' : ''}`} onClick={() => setSelectedCity('moscow')}>
                    <div className="city-name">Москва</div>
                  </div>
                  <div className={`city-option spb ${selectedCity === 'spb' ? 'active' : ''}`} onClick={() => setSelectedCity('spb')}>
                    <div className="city-name">Санкт-Петербург</div>
                  </div>
                </div>
              </div>
              
              <div className="form-group">
                <label>Пол:</label>
                <div className="gender-options">
                  <div className={`gender-option ${selectedGender === 'male' ? 'active' : ''}`} onClick={() => setSelectedGender('male')}>Мужской</div>
                  <div className={`gender-option ${selectedGender === 'female' ? 'active' : ''}`} onClick={() => setSelectedGender('female')}>Женский</div>
                </div>
              </div>
              
              <button className="btn" onClick={handleEnterWaitingRoom} disabled={isLoading}>
                {isLoading ? 'Загрузка...' : 'Войти в комнату ожидания'}
              </button>
            </div>
          )}

          {/* ЭКРАН ОЖИДАНИЯ */}
          {currentScreen === 'waiting' && (
            <div className="screen">
              <button className="back-btn" onClick={() => setCurrentScreen('setup')}>← Изменить параметры</button>
              
              <h2>Комната ожидания</h2>
              
              <div className="stations-map-container">
                <h3>🗺️ Карта станций</h3>
                
                <div className="map-legend">
                  <div className="legend-item"><div className="legend-color connected"></div><span>Выбрали станцию: {stationsData.totalStats?.total_connected || 0}</span></div>
                  <div className="legend-item"><div className="legend-color waiting"></div><span>В ожидании: {stationsData.totalStats?.total_waiting || 0}</span></div>
                </div>
                
                <div className="metro-map">{renderStationsMap()}</div>
              </div>

              <div className="user-settings-panel">
                <h4>Ваши параметры</h4>
                
                <div className="form-group">
                  <label>Номер вагона</label>
                  <select value={wagonNumber} onChange={(e) => setWagonNumber(e.target.value)}>
                    <option value="">Не указывать</option>
                    {[1,2,3,4,5,6,7,8].map(num => <option key={num} value={num}>{num}</option>)}
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Цвет одежды *</label>
                  <input 
                    type="text" 
                    placeholder="Например: черный верх, синий низ" 
                    value={clothingColor}
                    onChange={(e) => {
                      setClothingColor(e.target.value);
                      setErrors({ clothingColor: false });
                    }}
                    className={errors.clothingColor ? 'error-input' : ''}
                  />
                </div>
                
                <button className="btn btn-success" onClick={handleConfirmStation} disabled={isLoading}>
                  {isLoading ? 'Присоединение...' : 'Подтвердить и присоединиться'}
                </button>
              </div>
            </div>
          )}

          {/* ЭКРАН ПРИСОЕДИНЕНИЯ */}
          {currentScreen === 'joined' && (
            <div className="screen">
              <button className="back-btn" onClick={handleLeaveGroup}>← Вернуться к поиску</button>
              
              <h2>Вы выбрали станцию {currentGroup?.station}</h2>
              
              <div className="status-indicators">
                <div className="status-indicator">📍 Позиция: <span>{selectedPosition || 'не выбрана'}</span></div>
                <div className="status-indicator">😊 Настроение: <span>{selectedMood || 'не выбрано'}</span></div>
              </div>
              
              <div className="state-section">
                <h4>🎯 Ваша позиция</h4>
                <div className="state-cards">
                  {[
                    { position: "Брожу по станции", icon: "🚶" },
                    { position: "Сижу на станции", icon: "🙋" },
                    { position: "Иду к поезду", icon: "🚀" },
                    { position: "Стою по центру в вагоне", icon: "🧍" },
                    { position: "Стою у двери в вагоне", icon: "🚪" },
                    { position: "Сижу по центру в вагоне", icon: "💺" },
                    { position: "Сижу у двери в вагоне", icon: "🪑" },
                    { position: "Сижу читаю в вагоне", icon: "📖" }
                  ].map(item => (
                    <div key={item.position} className={`state-card ${selectedPosition === item.position ? 'active' : ''}`} onClick={() => setSelectedPosition(item.position)}>
                      <div className="state-icon">{item.icon}</div>
                      <div className="state-name">{item.position}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="state-section">
                <h4>😊 Ваше состояние</h4>
                <div className="state-cards">
                  {[
                    { mood: "Просто наблюдаю", icon: "👀" },
                    { mood: "Сплю", icon: "😴" },
                    { mood: "Хорошее настроение", icon: "😊" },
                    { mood: "Плохое настроение", icon: "😔" },
                    { mood: "Жду когда подойдут", icon: "⏳" },
                    { mood: "Собираюсь подойти", icon: "🚶" }
                  ].map(item => (
                    <div key={item.mood} className={`state-card ${selectedMood === item.mood ? 'active' : ''}`} onClick={() => setSelectedMood(item.mood)}>
                      <div className="state-icon">{item.icon}</div>
                      <div className="state-name">{item.mood}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="users-list-section">
                <h3>👥 Участники на вашей станции</h3>
                <div id="group-members">{renderGroupMembers()}</div>
              </div>
              
              <button className="btn btn-danger" onClick={handleLeaveGroup}>Покинуть группу</button>
            </div>
          )}
        </div>
        
        <footer>© 2026 | Метрос | Санкт-Петербург</footer>
      </div>
    </div>
  );
};