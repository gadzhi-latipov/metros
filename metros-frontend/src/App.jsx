import { useState, useEffect, useRef, useCallback } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';

// Упрощенное хранение deviceId без лишних логов
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

// Упрощенная генерация сессии
const generateSessionId = (deviceId) => {
  return `s_${deviceId}_${Date.now()}`;
};

// Упрощенное сохранение состояния сессии
const saveSessionState = (state) => {
  try {
    localStorage.setItem('metro_session_state', JSON.stringify({
      ...state,
      timestamp: Date.now()
    }));
  } catch (error) {
    // Тихая ошибка
  }
};

// Упрощенная загрузка состояния сессии
const loadSessionState = () => {
  try {
    const sessionData = localStorage.getItem('metro_session_state');
    if (sessionData) {
      const parsed = JSON.parse(sessionData);
      // Сессия действительна до 6 часов
      if (Date.now() - parsed.timestamp < 6 * 60 * 60 * 1000) {
        return parsed;
      }
      localStorage.removeItem('metro_session_state');
    }
  } catch (error) {
    // Тихая ошибка
  }
  return null;
};

// Упрощенная установка пользователя в оффлайн
const setUserOffline = async (userId, sessionId, deviceId) => {
  if (!userId) return;
  
  try {
    await api.updateUser(userId, { 
      online: false,
      is_connected: false,
      is_waiting: false,
      last_seen: new Date().toISOString(),
      status: 'Оффлайн'
    });
  } catch (error) {
    // Тихая ошибка
  }
};

// Оптимизированное вычисление статистики станций
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
  
  // Быстрый подсчет
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    if (!user.online) continue;
    
    if (user.is_waiting && !user.is_connected) {
      total_waiting++;
    } else if (user.is_connected && user.station) {
      total_connected++;
      if (stationStats[user.station]) {
        stationStats[user.station].connected++;
        stationStats[user.station].totalUsers++;
      }
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

export const App = () => {
  // Основные состояния
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
  const [isSessionRestoring, setIsSessionRestoring] = useState(false);
  const [nicknameError, setNicknameError] = useState(false);
  const [clothingColorError, setClothingColorError] = useState(false);
  const [stationError, setStationError] = useState(false);

  // Refs
  const userIdRef = useRef(null);
  const sessionIdRef = useRef('');
  const vkUserIdRef = useRef(null);
  const isAppActiveRef = useRef(true);
  const lastApiCallTimeRef = useRef(0);
  const lastStatsUpdateRef = useRef(0);
  const statsCacheRef = useRef(null);
  const activityTimeoutRef = useRef(null);
  const statsIntervalRef = useRef(null);

  // Константы
  const API_COOLDOWN = 2000; // 2 секунды между запросами
  const STATS_UPDATE_INTERVAL = 10000; // 10 секунд
  const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 минут

  // Оптимизированная загрузка статистики станций с кэшированием
  const loadStationsMap = useCallback(async (force = false) => {
    const now = Date.now();
    
    // Используем кэш если данные свежие (менее 5 секунд) и не форсируем обновление
    if (!force && statsCacheRef.current && (now - lastStatsUpdateRef.current < 5000)) {
      return statsCacheRef.current;
    }
    
    // Защита от слишком частых запросов
    if (now - lastApiCallTimeRef.current < API_COOLDOWN) {
      return statsCacheRef.current || stationsData;
    }
    
    lastApiCallTimeRef.current = now;
    
    try {
      const users = await api.getUsers();
      const stats = calculateStationsStats(users, selectedCity);
      
      setStationsData(stats);
      statsCacheRef.current = stats;
      lastStatsUpdateRef.current = now;
      
      return stats;
    } catch (error) {
      return statsCacheRef.current || stationsData;
    }
  }, [selectedCity, stationsData]);

  // Упрощенная проверка дубликатов
  const checkAndCleanDuplicates = useCallback(async () => {
    if (!deviceId) return;
    
    try {
      const users = await api.getUsers();
      const deviceSessions = users.filter(user => 
        user.device_id === deviceId && user.online === true
      );
      
      // Если есть несколько сессий с этого устройства, оставляем только последнюю
      if (deviceSessions.length > 1) {
        // Сортируем по времени последней активности
        deviceSessions.sort((a, b) => {
          const timeA = new Date(a.last_seen || 0).getTime();
          const timeB = new Date(b.last_seen || 0).getTime();
          return timeB - timeA;
        });
        
        const latestSession = deviceSessions[0];
        
        // Деактивируем старые сессии
        for (let i = 1; i < deviceSessions.length; i++) {
          const oldSession = deviceSessions[i];
          await api.updateUser(oldSession.id, {
            online: false,
            is_connected: false,
            is_waiting: false,
            status: 'Сессия заменена'
          });
        }
        
        // Обновляем текущую сессию если нужно
        if (userIdRef.current !== latestSession.id) {
          userIdRef.current = latestSession.id;
          sessionIdRef.current = latestSession.session_id || generateSessionId(deviceId);
          
          // Обновляем локальные данные
          if (latestSession.name) setNickname(latestSession.name);
          if (latestSession.city) setSelectedCity(latestSession.city);
          if (latestSession.gender) setSelectedGender(latestSession.gender);
          if (latestSession.color) setClothingColor(latestSession.color);
          if (latestSession.wagon) setWagonNumber(latestSession.wagon);
          if (latestSession.station) {
            setCurrentSelectedStation(latestSession.station);
            if (latestSession.is_connected) {
              setCurrentGroup({ station: latestSession.station, users: [] });
              setCurrentScreen('joined');
            } else if (latestSession.is_waiting) {
              setCurrentScreen('waiting');
            }
          }
        }
      }
    } catch (error) {
      // Тихая ошибка
    }
  }, [deviceId]);

  // Упрощенное восстановление сессии
  const restoreUserSession = useCallback(async () => {
    if (isSessionRestoring) return;
    
    setIsSessionRestoring(true);
    
    try {
      const savedState = loadSessionState();
      
      if (savedState) {
        userIdRef.current = savedState.userId;
        sessionIdRef.current = generateSessionId(deviceId);
        
        // Быстрое восстановление данных
        if (savedState.nickname) setNickname(savedState.nickname);
        if (savedState.selectedCity) setSelectedCity(savedState.selectedCity);
        if (savedState.selectedGender) setSelectedGender(savedState.selectedGender);
        if (savedState.clothingColor) setClothingColor(savedState.clothingColor);
        if (savedState.wagonNumber) setWagonNumber(savedState.wagonNumber);
        if (savedState.currentSelectedStation) {
          setCurrentSelectedStation(savedState.currentSelectedStation);
        }
        
        // Устанавливаем экран
        const targetScreen = savedState.currentScreen || 'setup';
        setCurrentScreen(targetScreen);
        
        // Если был в группе
        if (targetScreen === 'joined' && savedState.currentSelectedStation) {
          setCurrentGroup({ station: savedState.currentSelectedStation, users: [] });
        }
        
        // Проверяем серверную сессию
        try {
          const users = await api.getUsers();
          const serverSession = users.find(user => 
            (user.id === savedState.userId || user.name === savedState.nickname) && 
            user.online === true
          );
          
          if (serverSession) {
            await api.updateUser(serverSession.id, {
              online: true,
              is_connected: targetScreen === 'joined',
              is_waiting: targetScreen === 'waiting',
              last_seen: new Date().toISOString(),
              session_id: sessionIdRef.current,
              device_id: deviceId
            });
            
            userIdRef.current = serverSession.id;
          }
        } catch (error) {
          // Продолжаем с локальной сессией
        }
      }
    } catch (error) {
      // Начинаем с настройки
      setCurrentScreen('setup');
    } finally {
      setIsSessionRestoring(false);
    }
  }, [deviceId, isSessionRestoring]);

  // Основная инициализация приложения
  useEffect(() => {
    const generatedDeviceId = generateDeviceId();
    setDeviceId(generatedDeviceId);
    
    // Быстрая загрузка сохраненных данных
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
    
    // Инициализация VK Bridge
    bridge.send("VKWebAppInit");
    
    // Только необходимые подписки
    bridge.subscribe((event) => {
      if (!event.detail) return;
      
      const { type, data } = event.detail;
      if (type === 'VKWebAppUpdateConfig') {
        const schemeAttribute = document.createAttribute('scheme');
        schemeAttribute.value = data.scheme ? data.scheme : 'client_light';
        document.body.attributes.setNamedItem(schemeAttribute);
      }
    });
    
    // Загружаем данные пользователя VK
    bridge.send('VKWebAppGetUserInfo')
      .then(user => {
        vkUserIdRef.current = user.id;
      })
      .catch(() => {
        // Тихая ошибка
      });
    
    // Восстанавливаем сессию с небольшой задержкой
    const timer = setTimeout(() => {
      restoreUserSession();
    }, 300);
    
    // Настройка обновления статистики
    const setupStatsUpdates = () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
      }
      
      statsIntervalRef.current = setInterval(() => {
        if (currentScreen === 'waiting' || currentScreen === 'joined') {
          loadStationsMap();
        }
      }, STATS_UPDATE_INTERVAL);
    };
    
    setupStatsUpdates();
    
    // Обработчики онлайн/офлайн
    const handleOnline = () => {
      setIsOnline(true);
      if (userIdRef.current && (currentScreen === 'waiting' || currentScreen === 'joined')) {
        loadStationsMap(true);
      }
    };
    
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Таймер неактивности
    const resetInactivityTimer = () => {
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
      
      activityTimeoutRef.current = setTimeout(() => {
        if (userIdRef.current && isAppActiveRef.current) {
          setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
        }
      }, INACTIVITY_TIMEOUT);
    };
    
    resetInactivityTimer();
    
    // Обработчики активности пользователя
    const handleUserActivity = () => {
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
        resetInactivityTimer();
      }
    };
    
    window.addEventListener('click', handleUserActivity);
    window.addEventListener('keypress', handleUserActivity);
    window.addEventListener('scroll', handleUserActivity);
    
    return () => {
      clearTimeout(timer);
      clearInterval(statsIntervalRef.current);
      clearTimeout(activityTimeoutRef.current);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('click', handleUserActivity);
      window.removeEventListener('keypress', handleUserActivity);
      window.removeEventListener('scroll', handleUserActivity);
      
      if (userIdRef.current && isAppActiveRef.current) {
        setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
      }
    };
  }, []);

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
  }, [currentScreen]);

  // Загрузка участников группы
  const loadGroupMembers = useCallback(async (station = null) => {
    const targetStation = station || (currentGroup ? currentGroup.station : null);
    if (!targetStation) {
      setGroupMembers([]);
      return;
    }
    
    try {
      const users = await api.getUsers();
      const groupUsers = users.filter(user => 
        user.station === targetStation && 
        user.is_connected === true &&
        user.online === true
      );
      setGroupMembers(groupUsers);
    } catch (error) {
      // Тихая ошибка
    }
  }, [currentGroup]);

  // Автоматическое обновление группы при активной сессии
  useEffect(() => {
    let groupUpdateInterval;
    
    if (currentScreen === 'joined' && currentGroup) {
      // Сразу загружаем участников
      loadGroupMembers(currentGroup.station);
      
      // Настраиваем периодическое обновление
      groupUpdateInterval = setInterval(() => {
        loadGroupMembers(currentGroup.station);
      }, 8000); // Каждые 8 секунд
    }
    
    return () => {
      if (groupUpdateInterval) {
        clearInterval(groupUpdateInterval);
      }
    };
  }, [currentScreen, currentGroup, loadGroupMembers]);

  // Сохранение состояний в localStorage
  useEffect(() => {
    if (isSessionRestoring) return;
    
    // Сохраняем только основные данные
    localStorage.setItem('selectedCity', selectedCity);
    localStorage.setItem('selectedGender', selectedGender);
    localStorage.setItem('nickname', nickname);
    localStorage.setItem('clothingColor', clothingColor);
    localStorage.setItem('wagonNumber', wagonNumber);
    localStorage.setItem('selectedStation', currentSelectedStation || '');
    localStorage.setItem('currentScreen', currentScreen);
    
    if (userIdRef.current) {
      saveSessionState({
        userId: userIdRef.current,
        nickname,
        selectedCity,
        selectedGender,
        clothingColor,
        wagonNumber,
        currentSelectedStation,
        deviceId,
        currentScreen,
        timestamp: Date.now()
      });
    }
  }, [selectedCity, selectedGender, nickname, clothingColor, wagonNumber, currentSelectedStation, currentScreen, deviceId, isSessionRestoring]);

  // Обновление состояния пользователя
  const updateUserState = useCallback(async () => {
    if (!userIdRef.current) return;
    
    const status = selectedPosition && selectedMood 
      ? `${selectedPosition} | ${selectedMood}`
      : selectedPosition || selectedMood || 'Ожидание';
    
    try {
      await api.updateUser(userIdRef.current, { 
        status,
        position: selectedPosition,
        mood: selectedMood,
        last_seen: new Date().toISOString()
      });
      
      // Локальное обновление
      setGroupMembers(prev => 
        prev.map(member => 
          member.id === userIdRef.current 
            ? { ...member, status, position: selectedPosition, mood: selectedMood }
            : member
        )
      );
    } catch (error) {
      // Тихая ошибка
    }
  }, [selectedPosition, selectedMood]);

  // Дебаунс обновления состояния
  useEffect(() => {
    const timer = setTimeout(() => {
      if (userIdRef.current && (selectedPosition || selectedMood)) {
        updateUserState();
      }
    }, 800);
    
    return () => clearTimeout(timer);
  }, [selectedPosition, selectedMood, updateUserState]);

  // Вход в комнату ожидания
  const handleEnterWaitingRoom = async () => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setNicknameError(true);
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Пожалуйста, введите ваш никнейм'
      });
      return;
    }
    
    setIsLoading(true);
    
    try {
      const users = await api.getUsers();
      const existingSession = users.find(user => 
        user.device_id === deviceId && user.online === true
      );
      
      const newSessionId = generateSessionId(deviceId);
      
      if (existingSession) {
        // Обновляем существующую сессию
        await api.updateUser(existingSession.id, {
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
        });
        
        userIdRef.current = existingSession.id;
        sessionIdRef.current = newSessionId;
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
          position: '',
          mood: '',
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
          sessionIdRef.current = newSessionId;
        }
      }
      
      setCurrentScreen('waiting');
      await loadStationsMap(true);
      
      bridge.send("VKWebAppShowSnackbar", {
        text: '✅ Профиль создан успешно'
      });
    } catch (error) {
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Ошибка создания сессии'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Подтверждение выбора станции
  const handleConfirmStation = async () => {
    if (!clothingColor.trim()) {
      setClothingColorError(true);
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Укажите цвет одежды'
      });
      return;
    }
    
    if (!currentSelectedStation) {
      setStationError(true);
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Выберите станцию'
      });
      return;
    }

    if (!userIdRef.current) {
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Сначала создайте профиль'
      });
      return;
    }

    setIsLoading(true);
    
    try {
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

      const users = await api.getUsers();
      const stationUsers = users.filter(user => 
        user.station === currentSelectedStation && 
        user.is_connected === true &&
        user.online === true
      );
      
      setCurrentGroup({
        station: currentSelectedStation,
        users: stationUsers
      });
      
      setGroupMembers(stationUsers);
      setCurrentScreen('joined');
      
      bridge.send("VKWebAppShowSnackbar", {
        text: `✅ Вы присоединились к станции ${currentSelectedStation}`
      });
      
    } catch (error) {
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Ошибка присоединения'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Выход из группы
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
        // Тихая ошибка
      }
    }
    
    setCurrentGroup(null);
    setCurrentScreen('waiting');
    setSelectedPosition('');
    setSelectedMood('');
    setCurrentSelectedStation(null);
    
    bridge.send("VKWebAppShowSnackbar", {
      text: 'Вы вышли из комнаты станции'
    });
  };

  // Рендер карты станций
  const renderStationsMap = useCallback(() => {
    const { stationStats } = stationsData;
    
    if (stationStats.length === 0) {
      return (
        <div className="loading" style={{ textAlign: 'center', padding: '20px' }}>
          <div>Загрузка карты станций...</div>
        </div>
      );
    }
    
    const cityStations = helpers.stations[selectedCity] || [];
    
    return cityStations.map(stationName => {
      const stationData = stationStats.find(s => s.station === stationName);
      let waitingCount = 0;
      let connectedCount = 0;
      let stationClass = 'empty';
      
      if (stationData) {
        waitingCount = stationData.waiting || 0;
        connectedCount = stationData.connected || 0;
        
        if (connectedCount > 0) {
          stationClass = 'connected';
        } else if (waitingCount > 0) {
          stationClass = 'waiting';
        }
      }
      
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

  // Рендер участников группы
  const renderGroupMembers = useCallback(() => {
    if (groupMembers.length === 0) {
      return <div className="no-requests">Нет участников на этой станции</div>;
    }
    
    return groupMembers.map(user => {
      const isCurrentUser = userIdRef.current && user.id === userIdRef.current;
      
      return (
        <div key={user.id} className={`user-state-display ${isCurrentUser ? 'current-user' : ''}`}>
          <div className="user-avatar" style={{background: user.color_code || '#007bff'}}>
            {user.name.charAt(0)}
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

  return (
    <div className="app-container">
      {!isOnline && (
        <div className="offline-indicator">
          ⚠️ Отсутствует соединение с интернетом
        </div>
      )}
      
      {(isLoading || isSessionRestoring) && (
        <div className="loader-card">
          <div className="loader-1">
            <div className="neuromorphic-circle"></div>
          </div>
          <div style={{textAlign: 'center', marginTop: '10px'}}>
            {isSessionRestoring ? 'Восстановление сессии...' : 'Загрузка...'}
          </div>
        </div>
      )}
      
      <div className="container">
        <header>
          <div className="header-main">
            <div className="header-title">
              <h1>Метрос</h1>
              <div className="subtitle">Встречай попутчика🚉✔</div>
            </div>
            <div className="header-icons">
              <div className="metro-icon">🚇</div>
            </div>
          </div>
        </header>
        
        <div className="content">
          {currentScreen === 'setup' && (
            <div id="setup-screen" className="screen active">
              <h2>Настройка профиля</h2>
              
              <div className="form-group">
                <label htmlFor="nickname-input" style={{ color: nicknameError ? '#ff4444' : '' }}>
                  Укажите Ваш никнейм *
                  {nicknameError && (
                    <span style={{ color: '#ff4444', marginLeft: '5px', fontSize: '12px' }}>
                      (обязательное поле)
                    </span>
                  )}
                </label>
                <input 
                  type="text" 
                  id="nickname-input" 
                  placeholder="Придумайте уникальное имя" 
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    setNicknameError(false);
                  }}
                  className={nicknameError ? 'error-input' : ''}
                  required 
                />
                {nicknameError && (
                  <small className="field-hint" style={{ color: '#ff4444' }}>
                    ❌ Это поле обязательно для заполнения
                  </small>
                )}
              </div>
              
              <div className="form-group">
                <label>Выберите город:</label>
                <div className="city-options">
                  <div 
                    className={`city-option moscow ${selectedCity === 'moscow' ? 'active' : ''}`}
                    onClick={() => setSelectedCity('moscow')}
                  >
                    <div className="city-name">Москва</div>
                    <div className="city-description">Московский метрополитен</div>
                  </div>
                  <div 
                    className={`city-option spb ${selectedCity === 'spb' ? 'active' : ''}`}
                    onClick={() => setSelectedCity('spb')}
                  >
                    <div className="city-name">Санкт-Петербург</div>
                    <div className="city-description">Петербургский метрополитен</div>
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
                disabled={isLoading || isSessionRestoring}
              >
                {isLoading ? 'Создание профиля...' : 'Войти в комнату ожидания'}
              </button>
            </div>
          )}

          {currentScreen === 'waiting' && (
            <div id="waiting-room-screen" className="screen">
              <button className="back-btn" onClick={() => setCurrentScreen('setup')}>
                <i>←</i> Изменить параметры
              </button>
              
              <h2>Комната ожидания</h2>
              
              <div className="stations-map-container">
                <h3>🗺️ Карта станций метро</h3>
                
                <div className="map-legend">
                  <div className="legend-item">
                    <div className="legend-color connected"></div>
                    <span>Выбрали станцию: {stationsData.totalStats?.total_connected || 0}</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-color waiting"></div>
                    <span>В режиме ожидания: {stationsData.totalStats?.total_waiting || 0}</span>
                  </div>
                </div>
                
                <div className="metro-map">
                  {renderStationsMap()}
                </div>
              </div>

              <div className="user-settings-panel">
                <h4>Ваши параметры</h4>
                
                <div className="form-group">
                  <label htmlFor="wagon-select">Номер вагона (необязательно)</label>
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
                    Цвет верхней одежды или стиль *
                  </label>
                  <input 
                    type="text" 
                    id="color-select" 
                    placeholder="Например: черный верх, синий низ" 
                    value={clothingColor}
                    onChange={(e) => {
                      setClothingColor(e.target.value);
                      setClothingColorError(false);
                    }}
                    className={clothingColorError ? 'error-input' : ''}
                    required 
                  />
                  {clothingColorError && (
                    <small className="field-hint" style={{ color: '#ff4444' }}>
                      ❌ Это поле обязательно для заполнения
                    </small>
                  )}
                </div>
                
                <button 
                  className="btn btn-success" 
                  onClick={handleConfirmStation}
                  disabled={isLoading}
                >
                  {isLoading ? 'Присоединение...' : 'Подтвердить параметры и присоединиться'}
                </button>
              </div>
            </div>
          )}

          {currentScreen === 'joined' && (
            <div id="joined-room-screen" className="screen">
              <button className="back-btn" onClick={handleLeaveGroup}>
                <i>←</i> Вернуться к поиску
              </button>
              
              <h2>Вы выбрали станцию {currentGroup?.station}</h2>
              
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
                <h4>🎯 Ваша позиция на станции или в вагоне</h4>
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
                <h4>😊 Ваше текущее состояние</h4>
                <div className="state-cards">
                  {[
                    { mood: "Просто наблюдаю", icon: "👀" },
                    { mood: "Сплю", icon: "😴" },
                    { mood: "Хорошее настроение", icon: "😊" },
                    { mood: "Плохое настроение", icon: "😔" },
                    { mood: "Жду когда подойдут", icon: "⏳" },
                    { mood: "Собираюсь подойти", icon: "🚶" }
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
                <h3>👥 Участники на вашей станции</h3>
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
          &copy; 2026 | Метрос | Санкт-Петербург
        </footer>
      </div>
    </div>
  );
};