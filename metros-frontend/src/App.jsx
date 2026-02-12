import { useState, useEffect, useRef, useCallback } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';

// Упрощенное хранение deviceId
const generateDeviceId = () => {
  let deviceId = localStorage.getItem('metro_device_id');
  
  if (!deviceId) {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substr(2, 8);
    deviceId = `metro_${timestamp}_${randomStr}`;
    localStorage.setItem('metro_device_id', deviceId);
  }
  
  return deviceId;
};

// Быстрая генерация сессии
const generateSessionId = (deviceId) => {
  return `s_${deviceId}_${Date.now()}`;
};

// Сохранение сессии (только критичные данные)
const saveSessionState = (state) => {
  try {
    const essentialData = {
      userId: state.userId,
      nickname: state.nickname,
      currentScreen: state.currentScreen,
      timestamp: Date.now()
    };
    localStorage.setItem('metro_session_state', JSON.stringify(essentialData));
  } catch (error) {
    // Игнорируем
  }
};

// Загрузка сессии
const loadSessionState = () => {
  try {
    const sessionData = localStorage.getItem('metro_session_state');
    if (sessionData) {
      const parsed = JSON.parse(sessionData);
      // Сессия действительна 24 часа
      if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
        return parsed;
      }
      localStorage.removeItem('metro_session_state');
    }
  } catch (error) {
    // Игнорируем
  }
  return null;
};

// Установка оффлайн статуса
const setUserOffline = async (userId, sessionId, deviceId) => {
  if (!userId) return;
  
  try {
    await api.updateUser(userId, { 
      online: false,
      is_connected: false,
      is_waiting: false,
      last_seen: new Date().toISOString()
    });
  } catch (error) {
    // Игнорируем
  }
};

// Оптимизированное вычисление статистики (O(n))
const calculateStationsStats = (users, city) => {
  const stationStats = {};
  let total_connected = 0;
  let total_waiting = 0;
  
  const cityStations = helpers.stations[city] || [];
  
  // Быстрая инициализация
  for (let i = 0; i < cityStations.length; i++) {
    stationStats[cityStations[i]] = {
      station: cityStations[i],
      waiting: 0,
      connected: 0,
      totalUsers: 0
    };
  }
  
  // Один проход по массиву
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    if (!user.online) continue;
    
    if (user.is_waiting && !user.is_connected) {
      total_waiting++;
    } else if (user.is_connected && user.station && stationStats[user.station]) {
      total_connected++;
      stationStats[user.station].connected++;
      stationStats[user.station].totalUsers++;
    }
  }
  
  return {
    stationStats: Object.values(stationStats),
    totalStats: {
      total_connected,
      total_waiting,
      total_users: total_connected + total_waiting
    }
  };
};

// Быстрое получение данных пользователя по deviceId
const findUserByDeviceId = (users, deviceId) => {
  for (let i = 0; i < users.length; i++) {
    if (users[i].device_id === deviceId && users[i].online === true) {
      return users[i];
    }
  }
  return null;
};

export const App = () => {
  // Состояния
  const [currentScreen, setCurrentScreen] = useState('setup');
  const [selectedCity, setSelectedCity] = useState(() => localStorage.getItem('selectedCity') || 'spb');
  const [selectedGender, setSelectedGender] = useState(() => localStorage.getItem('selectedGender') || 'male');
  const [selectedPosition, setSelectedPosition] = useState('');
  const [selectedMood, setSelectedMood] = useState('');
  const [wagonNumber, setWagonNumber] = useState('');
  const [clothingColor, setClothingColor] = useState('');
  const [nickname, setNickname] = useState('');
  const [currentSelectedStation, setCurrentSelectedStation] = useState(null);
  const [currentGroup, setCurrentGroup] = useState(null);
  const [stationsData, setStationsData] = useState({ 
    stationStats: [], 
    totalStats: { total_connected: 0, total_waiting: 0, total_users: 0 } 
  });
  const [groupMembers, setGroupMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [deviceId, setDeviceId] = useState('');
  const [nicknameError, setNicknameError] = useState(false);
  const [clothingColorError, setClothingColorError] = useState(false);
  const [stationError, setStationError] = useState(false);

  // Refs
  const userIdRef = useRef(null);
  const sessionIdRef = useRef('');
  const vkUserIdRef = useRef(null);
  const isAppActiveRef = useRef(true);
  const statsCacheRef = useRef(null);
  const lastStatsUpdateRef = useRef(0);
  const statsIntervalRef = useRef(null);
  const initCompletedRef = useRef(false);

  // Константы
  const STATS_UPDATE_INTERVAL = 15000; // 15 секунд

  // ============= БЫСТРОЕ ВОССТАНОВЛЕНИЕ СЕССИИ =============
  const restoreUserSession = useCallback(async () => {
    if (!deviceId || initCompletedRef.current) return;
    
    try {
      // 1. Сначала проверяем локальное хранилище
      const savedState = loadSessionState();
      if (savedState?.userId) {
        userIdRef.current = savedState.userId;
        if (savedState.nickname) setNickname(savedState.nickname);
        if (savedState.currentScreen) setCurrentScreen(savedState.currentScreen);
        
        // 2. Асинхронно проверяем на сервере
        setTimeout(async () => {
          try {
            const users = await api.getUsers();
            const serverUser = users.find(u => u.id === savedState.userId && u.online === true);
            
            if (serverUser) {
              // Восстанавливаем остальные данные
              if (serverUser.city) setSelectedCity(serverUser.city);
              if (serverUser.gender) setSelectedGender(serverUser.gender);
              if (serverUser.color) setClothingColor(serverUser.color);
              if (serverUser.wagon) setWagonNumber(serverUser.wagon);
              if (serverUser.station) {
                setCurrentSelectedStation(serverUser.station);
                if (serverUser.is_connected) {
                  setCurrentGroup({ station: serverUser.station, users: [] });
                }
              }
              
              // Обновляем сессию
              sessionIdRef.current = generateSessionId(deviceId);
              await api.updateUser(serverUser.id, {
                last_seen: new Date().toISOString(),
                session_id: sessionIdRef.current,
                device_id: deviceId,
                online: true
              });
            }
          } catch (error) {
            // Игнорируем ошибки при фоновой проверке
          }
        }, 100);
      }
    } catch (error) {
      // Игнорируем, начинаем с чистого листа
    } finally {
      initCompletedRef.current = true;
    }
  }, [deviceId]);

  // ============= БЫСТРАЯ ЗАГРУЗКА СТАТИСТИКИ =============
  const loadStationsMap = useCallback(async (force = false) => {
    const now = Date.now();
    
    // Возвращаем кэш если он свежий (менее 3 секунд)
    if (!force && statsCacheRef.current && (now - lastStatsUpdateRef.current < 3000)) {
      setStationsData(statsCacheRef.current);
      return statsCacheRef.current;
    }
    
    try {
      const users = await api.getUsers();
      const stats = calculateStationsStats(users, selectedCity);
      
      setStationsData(stats);
      statsCacheRef.current = stats;
      lastStatsUpdateRef.current = now;
      
      return stats;
    } catch (error) {
      if (statsCacheRef.current) {
        setStationsData(statsCacheRef.current);
        return statsCacheRef.current;
      }
      return null;
    }
  }, [selectedCity]);

  // ============= БЫСТРЫЙ ВХОД В КОМНАТУ ОЖИДАНИЯ =============
  const handleEnterWaitingRoom = async () => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setNicknameError(true);
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Введите никнейм' });
      return;
    }
    
    setIsLoading(true);
    const startTime = Date.now();
    
    try {
      const users = await api.getUsers();
      
      // 1. Ищем существующую сессию по deviceId
      let user = findUserByDeviceId(users, deviceId);
      const newSessionId = generateSessionId(deviceId);
      
      if (user) {
        // Обновляем существующего пользователя
        await api.updateUser(user.id, {
          name: trimmedNickname,
          city: selectedCity,
          gender: selectedGender,
          session_id: newSessionId,
          online: true,
          is_waiting: true,
          is_connected: false,
          last_seen: new Date().toISOString()
        });
        
        userIdRef.current = user.id;
      } else {
        // Создаем нового пользователя
        const userData = {
          name: trimmedNickname,
          station: '',
          wagon: '',
          color: '',
          colorCode: helpers.getRandomColor(),
          status: 'В режиме ожидания',
          online: true,
          city: selectedCity,
          gender: selectedGender,
          is_waiting: true,
          is_connected: false,
          session_id: newSessionId,
          device_id: deviceId,
          vk_user_id: vkUserIdRef.current,
          last_seen: new Date().toISOString()
        };

        const createdUser = await api.createUser(userData);
        if (createdUser?.id) {
          userIdRef.current = createdUser.id;
        }
      }
      
      sessionIdRef.current = newSessionId;
      
      // 2. Сохраняем сессию
      saveSessionState({
        userId: userIdRef.current,
        nickname: trimmedNickname,
        currentScreen: 'waiting'
      });
      
      // 3. Мгновенно переключаем экран (без ожидания статистики)
      setCurrentScreen('waiting');
      
      // 4. Загружаем статистику в фоне
      setTimeout(() => loadStationsMap(true), 50);
      
      const responseTime = Date.now() - startTime;
      console.log(`Регистрация заняла: ${responseTime}мс`);
      
      bridge.send("VKWebAppShowSnackbar", { text: '✅ Профиль создан' });
      
    } catch (error) {
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Ошибка создания' });
    } finally {
      setIsLoading(false);
    }
  };

  // ============= БЫСТРОЕ ПРИСОЕДИНЕНИЕ К СТАНЦИИ =============
  const handleConfirmStation = async () => {
    if (!clothingColor.trim()) {
      setClothingColorError(true);
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Укажите цвет одежды' });
      return;
    }
    
    if (!currentSelectedStation) {
      setStationError(true);
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Выберите станцию' });
      return;
    }

    if (!userIdRef.current) {
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Сначала создайте профиль' });
      return;
    }

    setIsLoading(true);
    const startTime = Date.now();
    
    try {
      // 1. Обновляем пользователя
      await api.updateUser(userIdRef.current, {
        station: currentSelectedStation,
        wagon: wagonNumber,
        color: clothingColor.trim(),
        name: nickname.trim(),
        is_waiting: false,
        is_connected: true,
        online: true,
        last_seen: new Date().toISOString(),
        status: `На станции: ${currentSelectedStation}`
      });

      // 2. Мгновенно обновляем UI
      setCurrentGroup({
        station: currentSelectedStation,
        users: []
      });
      
      setCurrentScreen('joined');
      
      // 3. Сохраняем сессию
      saveSessionState({
        userId: userIdRef.current,
        nickname: nickname.trim(),
        currentScreen: 'joined'
      });
      
      // 4. Загружаем участников в фоне
      setTimeout(() => {
        loadGroupMembers(currentSelectedStation);
      }, 100);
      
      const responseTime = Date.now() - startTime;
      console.log(`Присоединение к станции заняло: ${responseTime}мс`);
      
      bridge.send("VKWebAppShowSnackbar", { 
        text: `✅ Вы на станции ${currentSelectedStation}` 
      });
      
    } catch (error) {
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Ошибка присоединения' });
    } finally {
      setIsLoading(false);
    }
  };

  // ============= ЗАГРУЗКА УЧАСТНИКОВ ГРУППЫ =============
  const loadGroupMembers = useCallback(async (station = null) => {
    const targetStation = station || (currentGroup ? currentGroup.station : null);
    if (!targetStation) {
      setGroupMembers([]);
      return;
    }
    
    try {
      const users = await api.getUsers();
      const groupUsers = [];
      
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        if (user.station === targetStation && 
            user.is_connected === true &&
            user.online === true) {
          groupUsers.push(user);
        }
      }
      
      setGroupMembers(groupUsers);
    } catch (error) {
      // Игнорируем
    }
  }, [currentGroup]);

  // ============= ОБНОВЛЕНИЕ СОСТОЯНИЯ ПОЛЬЗОВАТЕЛЯ =============
  const updateUserState = useCallback(async () => {
    if (!userIdRef.current) return;
    
    try {
      await api.updateUser(userIdRef.current, { 
        position: selectedPosition,
        mood: selectedMood,
        last_seen: new Date().toISOString()
      });
    } catch (error) {
      // Игнорируем
    }
  }, [selectedPosition, selectedMood]);

  // ============= ВЫХОД ИЗ ГРУППЫ =============
  const handleLeaveGroup = async () => {
    if (userIdRef.current) {
      try {
        await api.updateUser(userIdRef.current, { 
          is_waiting: true,
          is_connected: false,
          station: '',
          status: 'В режиме ожидания',
          last_seen: new Date().toISOString()
        });
      } catch (error) {
        // Игнорируем
      }
    }
    
    setCurrentGroup(null);
    setCurrentScreen('waiting');
    setSelectedPosition('');
    setSelectedMood('');
    setCurrentSelectedStation(null);
    
    // Сохраняем состояние
    saveSessionState({
      userId: userIdRef.current,
      nickname,
      currentScreen: 'waiting'
    });
    
    bridge.send("VKWebAppShowSnackbar", { text: 'Вы вышли из группы' });
  };

  // ============= INIT ЭФФЕКТ =============
  useEffect(() => {
    const generatedDeviceId = generateDeviceId();
    setDeviceId(generatedDeviceId);
    
    // 1. Быстрая загрузка сохраненных данных
    const savedNickname = localStorage.getItem('nickname');
    const savedClothingColor = localStorage.getItem('clothingColor');
    const savedWagonNumber = localStorage.getItem('wagonNumber');
    const savedSelectedStation = localStorage.getItem('selectedStation');
    const savedSelectedCity = localStorage.getItem('selectedCity');
    const savedSelectedGender = localStorage.getItem('selectedGender');
    
    if (savedNickname) setNickname(savedNickname);
    if (savedClothingColor) setClothingColor(savedClothingColor);
    if (savedWagonNumber) setWagonNumber(savedWagonNumber);
    if (savedSelectedStation) setCurrentSelectedStation(savedSelectedStation);
    if (savedSelectedCity) setSelectedCity(savedSelectedCity);
    if (savedSelectedGender) setSelectedGender(savedSelectedGender);
    
    // 2. Инициализация VK Bridge
    bridge.send("VKWebAppInit");
    
    bridge.subscribe((event) => {
      if (!event.detail) return;
      const { type, data } = event.detail;
      if (type === 'VKWebAppUpdateConfig') {
        const schemeAttribute = document.createAttribute('scheme');
        schemeAttribute.value = data.scheme ? data.scheme : 'client_light';
        document.body.attributes.setNamedItem(schemeAttribute);
      }
    });
    
    // 3. Получаем данные пользователя VK
    bridge.send('VKWebAppGetUserInfo')
      .then(user => {
        vkUserIdRef.current = user.id;
      })
      .catch(() => {});
    
    // 4. Восстанавливаем сессию (максимально быстро)
    restoreUserSession();
    
    // 5. Предзагрузка статистики
    setTimeout(() => {
      if (currentScreen === 'waiting' || currentScreen === 'joined') {
        loadStationsMap();
      }
    }, 200);
    
    // 6. Периодическое обновление статистики
    statsIntervalRef.current = setInterval(() => {
      if (currentScreen === 'waiting' || currentScreen === 'joined') {
        loadStationsMap();
      }
    }, STATS_UPDATE_INTERVAL);
    
    // 7. Обработчики онлайн/оффлайн
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      clearInterval(statsIntervalRef.current);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      
      if (userIdRef.current && isAppActiveRef.current) {
        setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Обновление интервала при смене экрана
  useEffect(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
    }
    
    if (currentScreen === 'waiting' || currentScreen === 'joined') {
      statsIntervalRef.current = setInterval(() => {
        loadStationsMap();
      }, STATS_UPDATE_INTERVAL);
    }
  }, [currentScreen, loadStationsMap]);

  // Обновление участников группы
  useEffect(() => {
    let interval;
    
    if (currentScreen === 'joined' && currentGroup) {
      loadGroupMembers(currentGroup.station);
      
      interval = setInterval(() => {
        loadGroupMembers(currentGroup.station);
      }, 10000); // Каждые 10 секунд
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentScreen, currentGroup, loadGroupMembers]);

  // Сохранение в localStorage
  useEffect(() => {
    localStorage.setItem('selectedCity', selectedCity);
    localStorage.setItem('selectedGender', selectedGender);
    localStorage.setItem('nickname', nickname);
    localStorage.setItem('clothingColor', clothingColor);
    localStorage.setItem('wagonNumber', wagonNumber);
    if (currentSelectedStation) {
      localStorage.setItem('selectedStation', currentSelectedStation);
    }
  }, [selectedCity, selectedGender, nickname, clothingColor, wagonNumber, currentSelectedStation]);

  // Дебаунс обновления состояния
  useEffect(() => {
    const timer = setTimeout(() => {
      if (userIdRef.current && (selectedPosition || selectedMood)) {
        updateUserState();
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [selectedPosition, selectedMood, updateUserState]);

  // ============= РЕНДЕР КОМПОНЕНТОВ =============
  
  const renderStationsMap = useCallback(() => {
    const { stationStats } = stationsData;
    const cityStations = helpers.stations[selectedCity] || [];
    
    if (cityStations.length === 0) {
      return <div className="loading">Загрузка станций...</div>;
    }
    
    return cityStations.map(stationName => {
      const stationData = stationStats.find(s => s.station === stationName);
      const connectedCount = stationData?.connected || 0;
      const waitingCount = stationData?.waiting || 0;
      
      let stationClass = 'empty';
      if (connectedCount > 0) stationClass = 'connected';
      else if (waitingCount > 0) stationClass = 'waiting';
      
      const isSelected = currentSelectedStation === stationName;
      
      return (
        <div 
          key={stationName}
          className={`station-map-item ${stationClass} ${isSelected ? 'selected' : ''}`}
          onClick={() => {
            setCurrentSelectedStation(stationName);
            setStationError(false);
          }}
        >
          <div className="station-name">{stationName}</div>
          <div className="station-counts">
            {waitingCount > 0 && (
              <span className="station-count count-waiting">{waitingCount}⏳</span>
            )}
            {connectedCount > 0 && (
              <span className="station-count count-connected">{connectedCount}✅</span>
            )}
            {waitingCount === 0 && connectedCount === 0 && (
              <span style={{fontSize: '10px', color: '#666'}}>Пусто</span>
            )}
          </div>
        </div>
      );
    });
  }, [stationsData, selectedCity, currentSelectedStation]);

  const renderGroupMembers = useCallback(() => {
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
              {user.name} {isCurrentUser && <span style={{color: '#007bff'}}>(Вы)</span>}
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
  }, [groupMembers]);

  // ============= ОСНОВНОЙ РЕНДЕР =============
  return (
    <div className="app-container">
      {!isOnline && (
        <div className="offline-indicator">
          ⚠️ Нет соединения с интернетом
        </div>
      )}
      
      {isLoading && (
        <div className="loader-card">
          <div className="loader-1">
            <div className="neuromorphic-circle"></div>
          </div>
          <div style={{textAlign: 'center', marginTop: '10px'}}>Загрузка...</div>
        </div>
      )}
      
      <div className="container">
        <header>
          <div className="header-main">
            <div className="header-title">
              <h1>Метрос</h1>
              <div className="subtitle">Встречай попутчика 🚉</div>
            </div>
            <div className="header-icons">
              <div className="metro-icon">🚇</div>
            </div>
          </div>
        </header>
        
        <div className="content">
          {/* ЭКРАН НАСТРОЙКИ */}
          {currentScreen === 'setup' && (
            <div id="setup-screen" className="screen active">
              <h2>Настройка профиля</h2>
              
              <div className="form-group">
                <label htmlFor="nickname-input" style={{ color: nicknameError ? '#ff4444' : '' }}>
                  Ваш никнейм *
                </label>
                <input 
                  type="text" 
                  id="nickname-input" 
                  placeholder="Придумайте имя" 
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    setNicknameError(false);
                  }}
                  className={nicknameError ? 'error-input' : ''}
                  autoFocus
                />
                {nicknameError && (
                  <small style={{ color: '#ff4444' }}>Обязательное поле</small>
                )}
              </div>
              
              <div className="form-group">
                <label>Город:</label>
                <div className="city-options">
                  <div 
                    className={`city-option moscow ${selectedCity === 'moscow' ? 'active' : ''}`}
                    onClick={() => setSelectedCity('moscow')}
                  >
                    <div className="city-name">Москва</div>
                  </div>
                  <div 
                    className={`city-option spb ${selectedCity === 'spb' ? 'active' : ''}`}
                    onClick={() => setSelectedCity('spb')}
                  >
                    <div className="city-name">Санкт-Петербург</div>
                  </div>
                </div>
              </div>
              
              <div className="form-group">
                <label>Ваш пол:</label>
                <div className="gender-options">
                  <div 
                    className={`gender-option ${selectedGender === 'male' ? 'active' : ''}`}
                    onClick={() => setSelectedGender('male')}
                  >
                    Мужской
                  </div>
                  <div 
                    className={`gender-option ${selectedGender === 'female' ? 'active' : ''}`}
                    onClick={() => setSelectedGender('female')}
                  >
                    Женский
                  </div>
                </div>
              </div>
              
              <button 
                type="button" 
                className="btn" 
                onClick={handleEnterWaitingRoom}
                disabled={isLoading}
              >
                {isLoading ? 'Создание...' : 'Войти в комнату ожидания'}
              </button>
            </div>
          )}

          {/* ЭКРАН ОЖИДАНИЯ */}
          {currentScreen === 'waiting' && (
            <div id="waiting-room-screen" className="screen">
              <button className="back-btn" onClick={() => setCurrentScreen('setup')}>
                <i>←</i> Изменить параметры
              </button>
              
              <h2>Комната ожидания</h2>
              
              <div className="stations-map-container">
                <h3>🗺️ Карта станций</h3>
                
                <div className="map-legend">
                  <div className="legend-item">
                    <div className="legend-color connected"></div>
                    <span>На станции: {stationsData.totalStats?.total_connected || 0}</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-color waiting"></div>
                    <span>В ожидании: {stationsData.totalStats?.total_waiting || 0}</span>
                  </div>
                </div>
                
                <div className="metro-map">
                  {renderStationsMap()}
                </div>
              </div>

              <div className="user-settings-panel">
                <h4>Ваши параметры</h4>
                
                <div className="form-group">
                  <label htmlFor="wagon-select">Вагон (необязательно)</label>
                  <select 
                    id="wagon-select" 
                    value={wagonNumber}
                    onChange={(e) => setWagonNumber(e.target.value)}
                  >
                    <option value="">Не указывать</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
                      <option key={num} value={num.toString()}>{num}</option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group">
                  <label htmlFor="color-select" style={{ color: clothingColorError ? '#ff4444' : '' }}>
                    Цвет одежды *
                  </label>
                  <input 
                    type="text" 
                    id="color-select" 
                    placeholder="Например: черный верх" 
                    value={clothingColor}
                    onChange={(e) => {
                      setClothingColor(e.target.value);
                      setClothingColorError(false);
                    }}
                    className={clothingColorError ? 'error-input' : ''}
                  />
                  {clothingColorError && (
                    <small style={{ color: '#ff4444' }}>Обязательное поле</small>
                  )}
                </div>
                
                <button 
                  className="btn btn-success" 
                  onClick={handleConfirmStation}
                  disabled={isLoading}
                >
                  {isLoading ? 'Присоединение...' : 'Присоединиться к станции'}
                </button>
              </div>
            </div>
          )}

          {/* ЭКРАН ПРИСОЕДИНЕНИЯ */}
          {currentScreen === 'joined' && (
            <div id="joined-room-screen" className="screen">
              <button className="back-btn" onClick={handleLeaveGroup}>
                <i>←</i> Вернуться к поиску
              </button>
              
              <h2>Станция {currentGroup?.station}</h2>
              
              <div className="status-indicators">
                <div className="status-indicator">
                  📍 Позиция: <span id="current-position">
                    {selectedPosition || 'не выбрана'}
                  </span>
                </div>
                <div className="status-indicator">
                  😊 Настроение: <span id="current-mood">
                    {selectedMood || 'не выбрано'}
                  </span>
                </div>
              </div>
              
              <div className="state-section">
                <h4>🎯 Ваша позиция</h4>
                <div className="state-cards">
                  {[
                    { position: "Брожу по станции", icon: "🚶" },
                    { position: "Сижу на станции", icon: "🙋" },
                    { position: "Иду к поезду", icon: "🚀" },
                    { position: "Стою в центре вагона", icon: "🧍" },
                    { position: "Стою у двери", icon: "🚪" },
                    { position: "Сижу в вагоне", icon: "💺" }
                  ].map((item) => (
                    <div 
                      key={item.position}
                      className={`state-card ${selectedPosition === item.position ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedPosition(item.position);
                        updateUserState();
                      }}
                    >
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
                    { mood: "Наблюдаю", icon: "👀" },
                    { mood: "Хорошее", icon: "😊" },
                    { mood: "Жду", icon: "⏳" },
                    { mood: "Иду", icon: "🚶" }
                  ].map((item) => (
                    <div 
                      key={item.mood}
                      className={`state-card ${selectedMood === item.mood ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedMood(item.mood);
                        updateUserState();
                      }}
                    >
                      <div className="state-icon">{item.icon}</div>
                      <div className="state-name">{item.mood}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="users-list-section">
                <h3>👥 Участники</h3>
                <div id="group-members">
                  {renderGroupMembers()}
                </div>
              </div>
              
              <button className="btn btn-danger" onClick={handleLeaveGroup}>
                Покинуть группу
              </button>
            </div>
          )}
        </div>
        
        <footer>
          &copy; 2026 | Метрос
        </footer>
      </div>
    </div>
  );
};