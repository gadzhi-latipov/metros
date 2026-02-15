import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';

// Константы для быстрого доступа
const STORAGE_KEYS = {
  DEVICE_ID: 'metro_device_id',
  SESSION: 'metro_session_state',
  NICKNAME: 'nickname',
  CITY: 'selectedCity',
  GENDER: 'selectedGender',
  COLOR: 'clothingColor',
  WAGON: 'wagonNumber',
  STATION: 'selectedStation',
  POSITION: 'selectedPosition',
  MOOD: 'selectedMood',
  SCREEN: 'currentScreen'
};

// Быстрое чтение из localStorage
const getStorageItem = (key, defaultValue = '') => {
  try {
    const item = localStorage.getItem(key);
    return item !== null ? item : defaultValue;
  } catch {
    return defaultValue;
  }
};

// Быстрая запись в localStorage (без блокировки)
const setStorageItem = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Игнорируем ошибки
  }
};

// Генерация deviceId (синхронно, без задержек)
const generateDeviceId = () => {
  let deviceId = getStorageItem(STORAGE_KEYS.DEVICE_ID);
  if (!deviceId) {
    deviceId = `metro_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    setStorageItem(STORAGE_KEYS.DEVICE_ID, deviceId);
  }
  return deviceId;
};

// Генерация sessionId (очень быстро)
const generateSessionId = (deviceId) => `s_${deviceId}_${Date.now()}`;

// Сохранение сессии (оптимизировано)
const saveSessionState = (state) => {
  try {
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify({
      ...state,
      t: Date.now() // короткое поле для timestamp
    }));
  } catch {
    // Игнорируем
  }
};

// Загрузка сессии (быстрая проверка)
const loadSessionState = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SESSION);
    if (!data) return null;
    
    const parsed = JSON.parse(data);
    // Сессия действительна 24 часа
    if (Date.now() - (parsed.t || 0) < 86400000) {
      return parsed;
    }
    localStorage.removeItem(STORAGE_KEYS.SESSION);
  } catch {}
  return null;
};

// Оптимизированный поиск пользователя
const findUserByDeviceId = (users, deviceId) => {
  for (let i = 0; i < users.length; i++) {
    if (users[i].device_id === deviceId && users[i].online) {
      return users[i];
    }
  }
  return null;
};

// Быстрое вычисление статистики
const calculateStationsStats = (users, city) => {
  const stationStats = {};
  let connected = 0;
  let waiting = 0;
  
  const cityStations = helpers.stations[city] || [];
  
  // Быстрая инициализация
  for (let i = 0; i < cityStations.length; i++) {
    const station = cityStations[i];
    stationStats[station] = { station, waiting: 0, connected: 0 };
  }
  
  // Один проход по пользователям
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    if (!user.online) continue;
    
    if (user.is_waiting && !user.is_connected) {
      waiting++;
    } else if (user.is_connected && user.station) {
      connected++;
      const stat = stationStats[user.station];
      if (stat) stat.connected++;
    }
  }
  
  return {
    stationStats: Object.values(stationStats),
    totalStats: { connected, waiting, total: connected + waiting }
  };
};

export const App = () => {
  // Состояния с начальными значениями из localStorage (мгновенно)
  const [currentScreen, setCurrentScreen] = useState(() => 
    getStorageItem(STORAGE_KEYS.SCREEN, 'setup')
  );
  const [selectedCity, setSelectedCity] = useState(() => 
    getStorageItem(STORAGE_KEYS.CITY, 'spb')
  );
  const [selectedGender, setSelectedGender] = useState(() => 
    getStorageItem(STORAGE_KEYS.GENDER, 'male')
  );
  const [nickname, setNickname] = useState(() => 
    getStorageItem(STORAGE_KEYS.NICKNAME, '')
  );
  const [clothingColor, setClothingColor] = useState(() => 
    getStorageItem(STORAGE_KEYS.COLOR, '')
  );
  const [wagonNumber, setWagonNumber] = useState(() => 
    getStorageItem(STORAGE_KEYS.WAGON, '')
  );
  const [currentSelectedStation, setCurrentSelectedStation] = useState(() => 
    getStorageItem(STORAGE_KEYS.STATION, '')
  );
  const [selectedPosition, setSelectedPosition] = useState(() => 
    getStorageItem(STORAGE_KEYS.POSITION, '')
  );
  const [selectedMood, setSelectedMood] = useState(() => 
    getStorageItem(STORAGE_KEYS.MOOD, '')
  );

  // UI состояния
  const [stationsData, setStationsData] = useState({ stationStats: [], totalStats: { connected: 0, waiting: 0, total: 0 } });
  const [groupMembers, setGroupMembers] = useState([]);
  const [currentGroup, setCurrentGroup] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [nicknameError, setNicknameError] = useState(false);
  const [clothingColorError, setClothingColorError] = useState(false);
  const [stationError, setStationError] = useState(false);

  // Refs для быстрого доступа
  const userIdRef = useRef(null);
  const sessionIdRef = useRef('');
  const deviceIdRef = useRef(generateDeviceId());
  const statsCacheRef = useRef({ data: null, time: 0 });
  const initDoneRef = useRef(false);

  // Мемоизированные данные
  const deviceId = deviceIdRef.current;
  
  // ========== БЫСТРАЯ ЗАГРУЗКА СТАТИСТИКИ ==========
  const loadStationsMap = useCallback(async (force = false) => {
    const now = Date.now();
    const cache = statsCacheRef.current;
    
    // Используем кэш если свежий (3 секунды)
    if (!force && cache.data && now - cache.time < 3000) {
      setStationsData(cache.data);
      return cache.data;
    }
    
    try {
      const users = await api.getUsers();
      const stats = calculateStationsStats(users, selectedCity);
      
      setStationsData(stats);
      statsCacheRef.current = { data: stats, time: now };
      return stats;
    } catch (error) {
      if (cache.data) setStationsData(cache.data);
      return cache.data;
    }
  }, [selectedCity]);

  // ========== БЫСТРОЕ ВОССТАНОВЛЕНИЕ СЕССИИ ==========
  const restoreSession = useCallback(async () => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;
    
    const saved = loadSessionState();
    if (!saved || !saved.userId) return;

    // Мгновенно восстанавливаем UI из saved state
    userIdRef.current = saved.userId;
    if (saved.nickname) setNickname(saved.nickname);
    if (saved.screen) setCurrentScreen(saved.screen);
    if (saved.station) {
      setCurrentSelectedStation(saved.station);
      if (saved.screen === 'joined') {
        setCurrentGroup({ station: saved.station, users: [] });
      }
    }

    // Фоновое обновление
    setTimeout(async () => {
      try {
        await api.pingActivity(saved.userId, {
          online: true,
          session_id: generateSessionId(deviceId),
          last_seen: new Date().toISOString()
        });
      } catch {
        // Если ошибка - сбрасываем на настройку
        setCurrentScreen('setup');
        userIdRef.current = null;
      }
    }, 100);
  }, [deviceId]);

  // ========== БЫСТРАЯ РЕГИСТРАЦИЯ (ГЛАВНОЕ УСКОРЕНИЕ) ==========
  const handleEnterWaitingRoom = useCallback(async () => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setNicknameError(true);
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Введите никнейм' });
      return;
    }

    setIsLoading(true);
    const newSessionId = generateSessionId(deviceId);
    
    try {
      // Пытаемся найти существующего пользователя
      const users = await api.getUsers();
      let existingUser = findUserByDeviceId(users, deviceId);

      if (existingUser) {
        // Обновляем существующего
        await api.updateUser(existingUser.id, {
          name: trimmedNickname,
          city: selectedCity,
          gender: selectedGender,
          session_id: newSessionId,
          online: true,
          is_waiting: true,
          last_seen: new Date().toISOString()
        });
        userIdRef.current = existingUser.id;
      } else {
        // Создаем нового
        const newUser = await api.createUser({
          name: trimmedNickname,
          city: selectedCity,
          gender: selectedGender,
          session_id: newSessionId,
          device_id: deviceId,
          online: true,
          is_waiting: true,
          last_seen: new Date().toISOString()
        });
        userIdRef.current = newUser.id;
      }

      sessionIdRef.current = newSessionId;
      
      // Сохраняем сессию
      saveSessionState({
        userId: userIdRef.current,
        nickname: trimmedNickname,
        city: selectedCity,
        gender: selectedGender,
        screen: 'waiting',
        station: '',
        t: Date.now()
      });

      // Мгновенно переключаем экран
      setCurrentScreen('waiting');
      
      // Сохраняем в localStorage
      setStorageItem(STORAGE_KEYS.NICKNAME, trimmedNickname);
      setStorageItem(STORAGE_KEYS.SCREEN, 'waiting');
      
      bridge.send("VKWebAppShowSnackbar", { text: '✅ Профиль создан' });
      
      // Загружаем статистику в фоне
      setTimeout(() => loadStationsMap(true), 50);
      
    } catch (error) {
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Ошибка' });
    } finally {
      setIsLoading(false);
    }
  }, [nickname, selectedCity, selectedGender, deviceId, loadStationsMap]);

  // ========== БЫСТРОЕ ПРИСОЕДИНЕНИЕ К СТАНЦИИ ==========
  const handleConfirmStation = useCallback(async () => {
    if (!clothingColor.trim()) {
      setClothingColorError(true);
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Укажите цвет' });
      return;
    }
    
    if (!currentSelectedStation) {
      setStationError(true);
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Выберите станцию' });
      return;
    }

    if (!userIdRef.current) {
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Создайте профиль' });
      return;
    }

    setIsLoading(true);
    
    try {
      // Обновляем на сервере
      await api.updateUser(userIdRef.current, {
        station: currentSelectedStation,
        wagon: wagonNumber,
        color: clothingColor.trim(),
        is_waiting: false,
        is_connected: true,
        last_seen: new Date().toISOString()
      });

      // Мгновенно обновляем UI
      setCurrentGroup({ station: currentSelectedStation, users: [] });
      setCurrentScreen('joined');
      
      // Сохраняем
      saveSessionState({
        userId: userIdRef.current,
        nickname,
        city: selectedCity,
        gender: selectedGender,
        color: clothingColor.trim(),
        wagon: wagonNumber,
        station: currentSelectedStation,
        screen: 'joined',
        t: Date.now()
      });

      setStorageItem(STORAGE_KEYS.STATION, currentSelectedStation);
      setStorageItem(STORAGE_KEYS.SCREEN, 'joined');
      
      bridge.send("VKWebAppShowSnackbar", { 
        text: `✅ Вы на станции ${currentSelectedStation}` 
      });
      
      // Загружаем участников в фоне
      setTimeout(() => loadGroupMembers(currentSelectedStation), 50);
      
    } catch (error) {
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Ошибка' });
    } finally {
      setIsLoading(false);
    }
  }, [clothingColor, currentSelectedStation, wagonNumber, nickname, selectedCity, selectedGender]);

  // ========== ЗАГРУЗКА УЧАСТНИКОВ ГРУППЫ ==========
  const loadGroupMembers = useCallback(async (station) => {
    if (!station) return;
    
    try {
      const users = await api.getUsers();
      const members = [];
      
      // Быстрый цикл
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        if (user.station === station && user.is_connected && user.online) {
          members.push(user);
        }
      }
      
      setGroupMembers(members);
    } catch (error) {
      // Игнорируем
    }
  }, []);

  // ========== ВЫХОД ИЗ ГРУППЫ ==========
  const handleLeaveGroup = useCallback(() => {
    if (userIdRef.current) {
      // Фоновое обновление
      api.updateUser(userIdRef.current, { 
        is_waiting: true,
        is_connected: false,
        station: ''
      }).catch(() => {});
    }
    
    // Мгновенный UI
    setCurrentGroup(null);
    setCurrentScreen('waiting');
    setSelectedPosition('');
    setSelectedMood('');
    
    saveSessionState({
      userId: userIdRef.current,
      nickname,
      city: selectedCity,
      gender: selectedGender,
      color: clothingColor,
      wagon: wagonNumber,
      screen: 'waiting',
      t: Date.now()
    });
    
    setStorageItem(STORAGE_KEYS.SCREEN, 'waiting');
  }, [nickname, selectedCity, selectedGender, clothingColor, wagonNumber]);

  // ========== ОБНОВЛЕНИЕ СТАТУСА ==========
  const updateUserState = useCallback(() => {
    if (!userIdRef.current) return;
    
    const status = selectedPosition && selectedMood 
      ? `${selectedPosition} | ${selectedMood}`
      : selectedPosition || selectedMood || 'Ожидание';
    
    // Не ждем ответа
    api.updateUser(userIdRef.current, { 
      status,
      position: selectedPosition,
      mood: selectedMood
    }).catch(() => {});
    
    // Локальное обновление
    setGroupMembers(prev => 
      prev.map(m => 
        m.id === userIdRef.current 
          ? { ...m, status, position: selectedPosition, mood: selectedMood }
          : m
      )
    );
  }, [selectedPosition, selectedMood]);

  // ========== ИНИЦИАЛИЗАЦИЯ ==========
  useEffect(() => {
    // Восстанавливаем сессию сразу
    restoreSession();
    
    // Инициализация VK Bridge
    bridge.send("VKWebAppInit");
    
    // Загружаем статистику
    loadStationsMap();
    
    // Online/offline
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [restoreSession, loadStationsMap]);

  // Периодическое обновление статистики
  useEffect(() => {
    const interval = setInterval(() => {
      if (currentScreen === 'waiting' || currentScreen === 'joined') {
        loadStationsMap();
      }
    }, 15000);
    
    return () => clearInterval(interval);
  }, [currentScreen, loadStationsMap]);

  // Обновление группы
  useEffect(() => {
    let interval;
    
    if (currentScreen === 'joined' && currentGroup?.station) {
      loadGroupMembers(currentGroup.station);
      
      interval = setInterval(() => {
        loadGroupMembers(currentGroup.station);
      }, 10000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentScreen, currentGroup?.station, loadGroupMembers]);

  // Дебаунс для обновления статуса
  useEffect(() => {
    const timer = setTimeout(updateUserState, 500);
    return () => clearTimeout(timer);
  }, [selectedPosition, selectedMood, updateUserState]);

  // Сохранение в localStorage
  useEffect(() => {
    setStorageItem(STORAGE_KEYS.CITY, selectedCity);
    setStorageItem(STORAGE_KEYS.GENDER, selectedGender);
    setStorageItem(STORAGE_KEYS.NICKNAME, nickname);
    setStorageItem(STORAGE_KEYS.COLOR, clothingColor);
    setStorageItem(STORAGE_KEYS.WAGON, wagonNumber);
    setStorageItem(STORAGE_KEYS.STATION, currentSelectedStation);
    setStorageItem(STORAGE_KEYS.POSITION, selectedPosition);
    setStorageItem(STORAGE_KEYS.MOOD, selectedMood);
    setStorageItem(STORAGE_KEYS.SCREEN, currentScreen);
  }, [selectedCity, selectedGender, nickname, clothingColor, wagonNumber, 
      currentSelectedStation, selectedPosition, selectedMood, currentScreen]);

  // ========== РЕНДЕР СТАНЦИЙ (МЕМОИЗИРОВАН) ==========
  const stationsMap = useMemo(() => {
    const { stationStats } = stationsData;
    const cityStations = helpers.stations[selectedCity] || [];
    
    if (stationStats.length === 0) {
      return <div className="loading" style={{textAlign:'center',padding:'20px'}}>Загрузка...</div>;
    }
    
    return cityStations.map(stationName => {
      const data = stationStats.find(s => s.station === stationName) || { waiting: 0, connected: 0 };
      const isSelected = currentSelectedStation === stationName;
      
      let className = 'station-map-item';
      if (data.connected > 0) className += ' connected';
      else if (data.waiting > 0) className += ' waiting';
      else className += ' empty';
      if (isSelected) className += ' selected';
      
      return (
        <div 
          key={stationName}
          className={className}
          onClick={() => {
            setCurrentSelectedStation(stationName);
            setStationError(false);
          }}
        >
          <div className="station-name">{stationName}</div>
          <div className="station-counts">
            {data.waiting > 0 && <span className="count-waiting">{data.waiting}⏳</span>}
            {data.connected > 0 && <span className="count-connected">{data.connected}✅</span>}
            {data.waiting === 0 && data.connected === 0 && <span style={{fontSize:'10px',color:'#666'}}>Пусто</span>}
          </div>
        </div>
      );
    });
  }, [stationsData, selectedCity, currentSelectedStation]);

  // ========== РЕНДЕР УЧАСТНИКОВ ==========
  const membersList = useMemo(() => {
    if (groupMembers.length === 0) {
      return <div className="no-requests">Нет участников</div>;
    }
    
    return groupMembers.map(user => {
      const isCurrent = userIdRef.current === user.id;
      
      return (
        <div key={user.id} className={`user-state-display ${isCurrent ? 'current-user' : ''}`}>
          <div className="user-avatar" style={{background: user.color_code || '#007bff'}}>
            {user.name?.charAt(0) || '?'}
          </div>
          <div className="user-state-info">
            <div className="user-state-name">
              {user.name} {isCurrent && <span style={{color:'#007bff'}}>(Вы)</span>}
            </div>
            <div className="user-state-details">
              {(user.position || user.mood) && (
                <div>
                  {user.position && <span>{user.position}</span>}
                  {user.position && user.mood && ' • '}
                  {user.mood && <span>{user.mood}</span>}
                </div>
              )}
              {user.color && (
                <div style={{marginTop:'4px',fontSize:'12px',color:'#666'}}>
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
  }, [groupMembers]);

  return (
    <div className="app-container">
      {!isOnline && <div className="offline-indicator">⚠️ Нет соединения</div>}
      
      {(isLoading || initDoneRef.current === false) && (
        <div className="loader-card">
          <div className="loader-1"><div className="neuromorphic-circle"></div></div>
        </div>
      )}
      
      <div className="container">
        <header>
          <div className="header-main">
            <div className="header-title">
              <h1>Метрос</h1>
              <div className="subtitle">🚇 Встречай попутчика</div>
            </div>
          </div>
        </header>
        
        <div className="content">
          {/* ЭКРАН НАСТРОЙКИ */}
          {currentScreen === 'setup' && (
            <div id="setup-screen" className="screen active">
              <h2>Настройка профиля</h2>
              
              <div className="form-group">
                <label style={{color:nicknameError?'#ff4444':''}}>Никнейм *</label>
                <input 
                  type="text" 
                  placeholder="Ваш никнейм" 
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    setNicknameError(false);
                  }}
                  className={nicknameError ? 'error-input' : ''}
                />
              </div>
              
              <div className="form-group">
                <label>Город:</label>
                <div className="city-options">
                  <div 
                    className={`city-option moscow ${selectedCity==='moscow'?'active':''}`}
                    onClick={() => setSelectedCity('moscow')}
                  >Москва</div>
                  <div 
                    className={`city-option spb ${selectedCity==='spb'?'active':''}`}
                    onClick={() => setSelectedCity('spb')}
                  >Санкт-Петербург</div>
                </div>
              </div>
              
              <div className="form-group">
                <label>Пол:</label>
                <div className="gender-options">
                  <div 
                    className={`gender-option ${selectedGender==='male'?'active':''}`}
                    onClick={() => setSelectedGender('male')}
                  >Мужской</div>
                  <div 
                    className={`gender-option ${selectedGender==='female'?'active':''}`}
                    onClick={() => setSelectedGender('female')}
                  >Женский</div>
                </div>
              </div>
              
              <button 
                className="btn" 
                onClick={handleEnterWaitingRoom}
                disabled={isLoading}
              >
                {isLoading ? '...' : 'Войти'}
              </button>
            </div>
          )}

          {/* ЭКРАН ОЖИДАНИЯ */}
          {currentScreen === 'waiting' && (
            <div id="waiting-room-screen" className="screen">
              <button className="back-btn" onClick={() => setCurrentScreen('setup')}>
                ← Изменить
              </button>
              
              <h2>Комната ожидания</h2>
              
              <div className="stations-map-container">
                <div className="map-legend">
                  <span>✅ {stationsData.totalStats?.connected || 0}</span>
                  <span>⏳ {stationsData.totalStats?.waiting || 0}</span>
                </div>
                
                <div className="metro-map">
                  {stationsMap}
                </div>
              </div>

              <div className="user-settings-panel">
                <h4>Ваши параметры</h4>
                
                <div className="form-group">
                  <label>Вагон</label>
                  <select value={wagonNumber} onChange={(e) => setWagonNumber(e.target.value)}>
                    <option value="">Не указан</option>
                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                
                <div className="form-group">
                  <label style={{color:clothingColorError?'#ff4444':''}}>Цвет одежды *</label>
                  <input 
                    type="text" 
                    placeholder="например: красная куртка" 
                    value={clothingColor}
                    onChange={(e) => {
                      setClothingColor(e.target.value);
                      setClothingColorError(false);
                    }}
                    className={clothingColorError ? 'error-input' : ''}
                  />
                </div>
                
                <button 
                  className="btn btn-success" 
                  onClick={handleConfirmStation}
                  disabled={isLoading}
                >
                  {isLoading ? '...' : 'Присоединиться'}
                </button>
              </div>
            </div>
          )}

          {/* ЭКРАН ПРИСОЕДИНЕНИЯ */}
          {currentScreen === 'joined' && (
            <div id="joined-room-screen" className="screen">
              <button className="back-btn" onClick={handleLeaveGroup}>
                ← Вернуться
              </button>
              
              <h2>Станция: {currentGroup?.station}</h2>
              
              <div className="state-section">
                <h4>🎯 Позиция</h4>
                <div className="state-cards">
                  {[
                    {pos:"Брожу по станции",icon:"🚶"},
                    {pos:"Сижу на станции",icon:"🙋"},
                    {pos:"Иду к поезду",icon:"🚀"},
                    {pos:"Стою в центре вагона",icon:"🧍"},
                    {pos:"Стою у двери",icon:"🚪"},
                    {pos:"Сижу в центре",icon:"💺"},
                    {pos:"Сижу у двери",icon:"🪑"},
                    {pos:"Читаю в вагоне",icon:"📖"}
                  ].map(item => (
                    <div 
                      key={item.pos}
                      className={`state-card ${selectedPosition===item.pos?'active':''}`}
                      onClick={() => setSelectedPosition(item.pos)}
                    >
                      <div className="state-icon">{item.icon}</div>
                      <div className="state-name">{item.pos}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="state-section">
                <h4>😊 Настроение</h4>
                <div className="state-cards">
                  {[
                    {mood:"Наблюдаю",icon:"👀"},
                    {mood:"Сплю",icon:"😴"},
                    {mood:"Хорошее",icon:"😊"},
                    {mood:"Плохое",icon:"😔"},
                    {mood:"Жду",icon:"⏳"},
                    {mood:"Подхожу",icon:"🚶"}
                  ].map(item => (
                    <div 
                      key={item.mood}
                      className={`state-card ${selectedMood===item.mood?'active':''}`}
                      onClick={() => setSelectedMood(item.mood)}
                    >
                      <div className="state-icon">{item.icon}</div>
                      <div className="state-name">{item.mood}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="users-list-section">
                <h3>👥 Участники ({groupMembers.length})</h3>
                <div id="group-members">
                  {membersList}
                </div>
              </div>
              
              <button className="btn btn-danger" onClick={handleLeaveGroup}>
                Покинуть
              </button>
            </div>
          )}
        </div>
        
        <footer>© 2026 Метрос</footer>
      </div>
    </div>
  );
};