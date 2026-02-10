import { useState, useEffect, useRef, useCallback } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';

// Устойчивое хранение deviceId
const generateDeviceId = () => {
  let deviceId = localStorage.getItem('metro_device_id');
  
  if (!deviceId) {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substr(2, 12);
    deviceId = `metro_${timestamp}_${randomStr}`;
    
    localStorage.setItem('metro_device_id', deviceId);
    console.log('🆕 Создан новый deviceId:', deviceId);
  } else {
    console.log('📱 Восстановлен существующий deviceId:', deviceId);
  }
  
  return deviceId;
};

// Генерация сессии
const generateSessionId = (deviceId) => {
  return `session_${deviceId}_${Date.now()}`;
};

// Сохранение состояния сессии
const saveSessionState = (state) => {
  try {
    const sessionData = {
      ...state,
      timestamp: Date.now()
    };
    
    localStorage.setItem('metro_session_state', JSON.stringify(sessionData));
  } catch (error) {
    console.error('❌ Ошибка сохранения состояния сессии:', error);
  }
};

// Загрузка состояния сессии
const loadSessionState = () => {
  try {
    const sessionData = localStorage.getItem('metro_session_state');
    
    if (sessionData) {
      const parsed = JSON.parse(sessionData);
      const now = Date.now();
      
      // Проверяем не старше 1 дня
      if (now - parsed.timestamp < 24 * 60 * 60 * 1000) {
        return parsed;
      } else {
        localStorage.removeItem('metro_session_state');
      }
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки состояния сессии:', error);
  }
  
  return null;
};

// Установка пользователя в оффлайн
const setUserOffline = async (userId, sessionId, deviceId) => {
  if (!userId) return;
  
  try {
    await api.updateUser(userId, { 
      online: false,
      is_connected: false,
      is_waiting: false,
      last_seen: new Date().toISOString(),
      session_id: sessionId,
      device_id: deviceId,
      status: 'Оффлайн'
    });
  } catch (error) {
    console.error('❌ Ошибка установки пользователя в оффлайн:', error);
  }
};

// Оптимизированное вычисление статистики станций
const calculateStationsStats = (users, city) => {
  try {
    const stationStats = {};
    let total_connected = 0;
    let total_waiting = 0;
    
    // Получаем список станций для выбранного города
    const cityStations = helpers.stations[city] || [];
    
    // Инициализируем все станции города с оптимизацией памяти
    cityStations.forEach(station => {
      stationStats[station] = {
        station: station,
        waiting: 0,
        connected: 0,
        totalUsers: 0
      };
    });
    
    // Оптимизированный подсчет пользователей по станциям
    users.forEach(user => {
      if (!user.online) return;
      
      if (user.is_waiting && !user.is_connected) {
        total_waiting++;
      } else if (user.is_connected && user.station) {
        total_connected++;
        
        if (stationStats[user.station]) {
          stationStats[user.station].connected++;
          stationStats[user.station].totalUsers++;
        }
      }
    });
    
    // Преобразуем объект в массив
    const stationStatsArray = Object.values(stationStats);
    
    return {
      stationStats: stationStatsArray,
      totalStats: {
        total_connected,
        total_waiting,
        total_users: total_connected + total_waiting
      }
    };
  } catch (error) {
    return {
      stationStats: [],
      totalStats: { total_connected: 0, total_waiting: 0, total_users: 0 }
    };
  }
};

export const App = () => {
  const [fetchedUser, setUser] = useState();
  const [appState, setAppState] = useState('active');
  const [currentScreen, setCurrentScreen] = useState('setup');
  const [selectedCity, setSelectedCity] = useState(() => localStorage.getItem('selectedCity') || 'spb');
  const [selectedGender, setSelectedGender] = useState(() => localStorage.getItem('selectedGender') || 'male');
  const [selectedPosition, setSelectedPosition] = useState('');
  const [selectedMood, setSelectedMood] = useState('');
  const [wagonNumber, setWagonNumber] = useState('');
  const [clothingColor, setClothingColor] = useState('');
  const [nickname, setNickname] = useState('');
  const [timerActive, setTimerActive] = useState(false);
  const [selectedMinutes, setSelectedMinutes] = useState(5);
  const [currentSelectedStation, setCurrentSelectedStation] = useState(null);
  const [currentGroup, setCurrentGroup] = useState(null);
  const [stationsData, setStationsData] = useState({ 
    stationStats: [], 
    totalStats: { total_connected: 0, total_waiting: 0, total_users: 0 } 
  });
  const [groupMembers, setGroupMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [usersCache, setUsersCache] = useState(null);
  const [cacheTimestamp, setCacheTimestamp] = useState(0);
  const [lastPingTime, setLastPingTime] = useState(0);
  const [lastActivityTime, setLastActivityTime] = useState(Date.now());
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [deviceId, setDeviceId] = useState('');
  const [isSessionRestoring, setIsSessionRestoring] = useState(false);
  const [nicknameError, setNicknameError] = useState(false);
  const [clothingColorError, setClothingColorError] = useState(false);
  const [stationError, setStationError] = useState(false);
  const [restoreAttempted, setRestoreAttempted] = useState(false);

  const CACHE_DURATION = 10000;
  const PING_INTERVAL = 15000;
  const INACTIVITY_TIMEOUT = 30 * 60 * 1000;
  const SHORT_INACTIVITY_TIMEOUT = 5 * 60 * 1000;

  const userIdRef = useRef(null);
  const globalRefreshIntervalRef = useRef(null);
  const sessionIdRef = useRef('');
  const vkUserIdRef = useRef(null);
  const nicknameInputRef = useRef(null);
  const clothingColorInputRef = useRef(null);
  const metroMapRef = useRef(null);
  const sessionRestoreInProgressRef = useRef(false);
  const appVisibilityHandlerRef = useRef(null);
  const offlineTimeoutRef = useRef(null);
  const pingTimeoutRef = useRef(null);
  const inactivityTimeoutRef = useRef(null);
  const isOfflineRequestRef = useRef(false);
  const isAppActiveRef = useRef(true);
  const userActivityRef = useRef(Date.now());
  const lastCleanupRef = useRef(0);
  const restoreTimeoutRef = useRef(null);
  const isRestoringFromServerRef = useRef(false);
  const isSettingUpRef = useRef(false);

  // Оптимизированная загрузка статистики станций
  const loadStationsMap = useCallback(async () => {
    try {
      // Используем кэш если есть актуальные данные
      const now = Date.now();
      if (usersCache && (now - cacheTimestamp) < CACHE_DURATION) {
        const stats = calculateStationsStats(usersCache, selectedCity);
        setStationsData(stats);
        return stats;
      }

      const users = await api.getUsers();
      const stats = calculateStationsStats(users, selectedCity);
      
      setStationsData(stats);
      
      const activeUsers = users.filter(user => user.online === true);
      setAllUsers(activeUsers);
      setUsersCache(activeUsers);
      setCacheTimestamp(now);
      
      return stats;
    } catch (error) {
      const emptyStats = {
        stationStats: [],
        totalStats: { total_connected: 0, total_waiting: 0, total_users: 0 }
      };
      setStationsData(emptyStats);
      return emptyStats;
    }
  }, [selectedCity, usersCache, cacheTimestamp]);

  // Оптимизированная проверка дубликатов
  const checkAndCleanDuplicates = useCallback(async () => {
    const now = Date.now();
    
    if (now - lastCleanupRef.current < 5000) {
      return;
    }
    
    lastCleanupRef.current = now;
    
    try {
      if (!deviceId) {
        return;
      }
      
      const users = await api.getUsers();
      
      // Находим все активные сессии с этого устройства
      const deviceSessions = users.filter(user => 
        user.device_id === deviceId && 
        user.online === true
      );
      
      // Если есть более одной сессии с этого устройства
      if (deviceSessions.length > 1) {
        // Сортируем по времени последней активности
        const sortedSessions = deviceSessions.sort((a, b) => {
          const timeA = new Date(a.last_seen || 0).getTime();
          const timeB = new Date(b.last_seen || 0).getTime();
          return timeB - timeA;
        });
        
        const latestSession = sortedSessions[0];
        
        // Деактивируем старые сессии
        for (let i = 1; i < sortedSessions.length; i++) {
          const oldSession = sortedSessions[i];
          if (oldSession.id !== latestSession.id) {
            await api.updateUser(oldSession.id, {
              online: false,
              is_connected: false,
              is_waiting: false,
              status: 'Сессия заменена',
              last_seen: new Date().toISOString()
            });
          }
        }
        
        // Если мы еще не на этой сессии, переключаемся
        if (userIdRef.current !== latestSession.id) {
          userIdRef.current = latestSession.id;
          sessionIdRef.current = latestSession.session_id || generateSessionId(deviceId);
          
          // Обновляем локальное состояние
          setNickname(latestSession.name || nickname);
          setSelectedCity(latestSession.city || selectedCity);
          setSelectedGender(latestSession.gender || selectedGender);
          setClothingColor(latestSession.color || clothingColor);
          setWagonNumber(latestSession.wagon || wagonNumber);
          
          if (latestSession.station) {
            setCurrentSelectedStation(latestSession.station);
          }
          
          // Определяем экран
          let targetScreen = 'setup';
          if (latestSession.is_connected && latestSession.station) {
            targetScreen = 'joined';
            setCurrentGroup({ station: latestSession.station, users: [] });
          } else if (latestSession.is_waiting) {
            targetScreen = 'waiting';
          }
          
          setCurrentScreen(targetScreen);
          
          // Сохраняем состояние
          saveSessionState({
            userId: userIdRef.current,
            nickname: latestSession.name || nickname,
            selectedCity: latestSession.city || selectedCity,
            selectedGender: latestSession.gender || selectedGender,
            clothingColor: latestSession.color || clothingColor,
            wagonNumber: latestSession.wagon || wagonNumber,
            currentSelectedStation: latestSession.station || currentSelectedStation,
            deviceId: deviceId,
            currentScreen: targetScreen,
            timestamp: Date.now()
          });
        }
      } else if (deviceSessions.length === 1) {
        // Только одна сессия с устройства
        const currentSession = deviceSessions[0];
        
        if (!userIdRef.current || userIdRef.current !== currentSession.id) {
          userIdRef.current = currentSession.id;
          sessionIdRef.current = currentSession.session_id || generateSessionId(deviceId);
          
          // Обновляем локальные данные из сессии
          if (currentSession.name && !nickname) setNickname(currentSession.name);
          if (currentSession.city && !selectedCity) setSelectedCity(currentSession.city);
          if (currentSession.gender && !selectedGender) setSelectedGender(currentSession.gender);
          if (currentSession.color && !clothingColor) setClothingColor(currentSession.color);
          if (currentSession.wagon && !wagonNumber) setWagonNumber(currentSession.wagon);
          if (currentSession.station && !currentSelectedStation) {
            setCurrentSelectedStation(currentSession.station);
          }
          
          // Определяем экран на основе состояния сессии
          let targetScreen = currentScreen;
          if (currentSession.is_connected && currentSession.station) {
            targetScreen = 'joined';
            setCurrentGroup({ station: currentSession.station, users: [] });
          } else if (currentSession.is_waiting) {
            targetScreen = 'waiting';
          }
          
          if (targetScreen !== currentScreen) {
            setCurrentScreen(targetScreen);
          }
          
          // Сохраняем состояние
          saveSessionState({
            userId: userIdRef.current,
            nickname: currentSession.name || nickname,
            selectedCity: currentSession.city || selectedCity,
            selectedGender: currentSession.gender || selectedGender,
            clothingColor: currentSession.color || clothingColor,
            wagonNumber: currentSession.wagon || wagonNumber,
            currentSelectedStation: currentSession.station || currentSelectedStation,
            deviceId: deviceId,
            currentScreen: targetScreen,
            timestamp: Date.now()
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Ошибка при проверке дублирующих сессий:', error);
    }
  }, [deviceId, selectedCity, selectedGender, clothingColor, wagonNumber, currentSelectedStation, currentScreen, nickname]);

  // Оптимизированное восстановление сессии
  const restoreUserSession = useCallback(async () => {
    if (sessionRestoreInProgressRef.current) {
      return;
    }
    
    sessionRestoreInProgressRef.current = true;
    setIsSessionRestoring(true);
    setRestoreAttempted(true);
    
    try {
      // Загружаем сохраненное состояние
      const savedState = loadSessionState();
      
      // Если есть сохраненное состояние, восстанавливаем из него
      if (savedState) {
        userIdRef.current = savedState.userId;
        sessionIdRef.current = generateSessionId(deviceId);
        
        // Восстанавливаем все поля
        setNickname(savedState.nickname || '');
        setSelectedCity(savedState.selectedCity || 'spb');
        setSelectedGender(savedState.selectedGender || 'male');
        setClothingColor(savedState.clothingColor || '');
        setWagonNumber(savedState.wagonNumber || '');
        setCurrentSelectedStation(savedState.currentSelectedStation || null);
        
        // Устанавливаем экран
        let targetScreen = savedState.currentScreen || 'setup';
        setCurrentScreen(targetScreen);
        
        // Если был в группе, устанавливаем группу
        if (targetScreen === 'joined' && savedState.currentSelectedStation) {
          setCurrentGroup({ station: savedState.currentSelectedStation, users: [] });
        }
        
        // Проверяем сервер на наличие активной сессии
        try {
          const users = await api.getUsers();
          
          // Ищем нашу сессию на сервере
          let serverSession = null;
          
          if (savedState.userId) {
            serverSession = users.find(user => 
              user.id === savedState.userId && 
              user.online === true
            );
          }
          
          if (!serverSession && savedState.nickname) {
            serverSession = users.find(user => 
              user.name === savedState.nickname && 
              user.online === true
            );
          }
          
          if (serverSession) {
            // Синхронизируем с сервером
            await api.updateUser(serverSession.id, {
              online: true,
              is_connected: targetScreen === 'joined',
              is_waiting: targetScreen === 'waiting',
              last_seen: new Date().toISOString(),
              session_id: sessionIdRef.current,
              device_id: deviceId,
              ...(targetScreen === 'joined' && savedState.currentSelectedStation && {
                station: savedState.currentSelectedStation
              })
            });
            
            userIdRef.current = serverSession.id;
            
            // Проверяем дубликаты
            await checkAndCleanDuplicates();
          }
          
        } catch (serverError) {
          console.error('❌ Ошибка проверки сервера:', serverError);
        }
        
      } else {
        setCurrentScreen('setup');
      }
      
    } catch (error) {
      console.error('❌ Критическая ошибка восстановления сессии:', error);
      setCurrentScreen('setup');
    } finally {
      setIsSessionRestoring(false);
      sessionRestoreInProgressRef.current = false;
      isRestoringFromServerRef.current = false;
    }
  }, [deviceId, checkAndCleanDuplicates]);

  // Основная инициализация приложения
  useEffect(() => {
    // Инициализация устройства
    const generatedDeviceId = generateDeviceId();
    setDeviceId(generatedDeviceId);
    
    // Загружаем сохраненные данные из localStorage
    const savedNickname = localStorage.getItem('nickname');
    const savedClothingColor = localStorage.getItem('clothingColor');
    const savedWagonNumber = localStorage.getItem('wagonNumber');
    const savedSelectedStation = localStorage.getItem('selectedStation');
    const savedSelectedCity = localStorage.getItem('selectedCity');
    const savedSelectedGender = localStorage.getItem('selectedGender');
    
    if (savedNickname && !nickname) setNickname(savedNickname);
    if (savedClothingColor && !clothingColor) setClothingColor(savedClothingColor);
    if (savedWagonNumber && !wagonNumber) setWagonNumber(savedWagonNumber);
    if (savedSelectedStation && !currentSelectedStation) setCurrentSelectedStation(savedSelectedStation);
    if (savedSelectedCity && selectedCity === 'spb') setSelectedCity(savedSelectedCity);
    if (savedSelectedGender && selectedGender === 'male') setSelectedGender(savedSelectedGender);
    
    // Инициализация VK Bridge
    bridge.send("VKWebAppInit");

    // Обработчик видимости страницы
    const handleVisibilityChange = () => {
      if (document.hidden) {
        isAppActiveRef.current = false;
        setAppState('background');
        
        clearTimeout(offlineTimeoutRef.current);
        offlineTimeoutRef.current = setTimeout(() => {
          if (!isAppActiveRef.current && userIdRef.current) {
            isOfflineRequestRef.current = true;
            setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
          }
        }, SHORT_INACTIVITY_TIMEOUT);
        
      } else {
        isAppActiveRef.current = true;
        setAppState('active');
        
        clearTimeout(offlineTimeoutRef.current);
        isOfflineRequestRef.current = false;
        
        if (userIdRef.current) {
          improvedPingActivity();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    appVisibilityHandlerRef.current = handleVisibilityChange;

    bridge.subscribe((event) => {
      if (!event.detail) return;
      
      const { type, data } = event.detail;
      
      switch (type) {
        case 'VKWebAppUpdateConfig':
          const schemeAttribute = document.createAttribute('scheme');
          schemeAttribute.value = data.scheme ? data.scheme : 'client_light';
          document.body.attributes.setNamedItem(schemeAttribute);
          break;
        case 'VKWebAppViewHide':
          setAppState('background');
          isAppActiveRef.current = false;
          
          clearTimeout(offlineTimeoutRef.current);
          offlineTimeoutRef.current = setTimeout(() => {
            if (!isAppActiveRef.current && userIdRef.current) {
              isOfflineRequestRef.current = true;
              setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
            }
          }, SHORT_INACTIVITY_TIMEOUT);
          break;
        case 'VKWebAppViewRestore':
          setAppState('active');
          isAppActiveRef.current = true;
          
          clearTimeout(offlineTimeoutRef.current);
          isOfflineRequestRef.current = false;
          
          if (userIdRef.current) {
            improvedPingActivity();
          }
          break;
        default:
          break;
      }
    });

    async function fetchUserData() {
      try {
        const user = await bridge.send('VKWebAppGetUserInfo');
        setUser(user);
        vkUserIdRef.current = user.id;
      } catch (error) {
        console.error('❌ Ошибка загрузки пользователя:', error);
      }
    }
    
    fetchUserData();
    
    // Запускаем восстановление сессии
    restoreTimeoutRef.current = setTimeout(() => {
      restoreUserSession();
    }, 100);
    
    // Запуск оптимизированного обновления
    const cleanupGlobalRefresh = () => {
      const interval = setInterval(async () => {
        try {
          if (userIdRef.current) {
            await checkAndCleanDuplicates();
            
            if (currentScreen === 'waiting') {
              await loadStationsMap();
            } else if (currentScreen === 'joined' && currentGroup) {
              await loadGroupMembers(currentGroup.station);
            }
            
            await improvedPingActivity();
          }
        } catch (error) {
          console.error('❌ Ошибка глобального обновления:', error);
        }
      }, 15000); // Увеличили интервал до 15 секунд
      
      globalRefreshIntervalRef.current = interval;
      return () => clearInterval(interval);
    };
    
    cleanupGlobalRefresh();

    // Таймер неактивности
    const startInactivityTimer = () => {
      const checkInactivity = () => {
        const now = Date.now();
        const timeSinceLastActivity = now - userActivityRef.current;
        
        if (timeSinceLastActivity > INACTIVITY_TIMEOUT && userIdRef.current && isAppActiveRef.current) {
          setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
        } else {
          inactivityTimeoutRef.current = setTimeout(checkInactivity, 60000);
        }
      };
      
      inactivityTimeoutRef.current = setTimeout(checkInactivity, 60000);
    };
    
    setTimeout(startInactivityTimer, 1000);

    // Обработчики онлайн/офлайн статуса
    const handleOnline = async () => {
      setIsOnline(true);
      
      if (userIdRef.current && (currentScreen === 'joined' || currentScreen === 'waiting')) {
        try {
          await checkAndCleanDuplicates();
          
          await api.updateUser(userIdRef.current, {
            online: true,
            last_seen: new Date().toISOString(),
            session_id: sessionIdRef.current,
            device_id: generatedDeviceId
          });
          
          if (currentScreen === 'joined') {
            await loadGroupMembers();
          } else if (currentScreen === 'waiting') {
            await loadStationsMap();
          }
        } catch (error) {
          console.error('❌ Ошибка восстановления сессии:', error);
        }
      }
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      
      if (userIdRef.current && !isOfflineRequestRef.current) {
        isOfflineRequestRef.current = true;
        setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
      }
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Очистка
    return () => {
      if (globalRefreshIntervalRef.current) {
        clearInterval(globalRefreshIntervalRef.current);
      }
      
      clearTimeout(offlineTimeoutRef.current);
      clearTimeout(pingTimeoutRef.current);
      clearTimeout(inactivityTimeoutRef.current);
      clearTimeout(restoreTimeoutRef.current);
      
      if (appVisibilityHandlerRef.current) {
        document.removeEventListener('visibilitychange', appVisibilityHandlerRef.current);
      }
      
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      
      if (userIdRef.current && isAppActiveRef.current) {
        setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
      }
    };
  }, []);

  // Оптимизированная загрузка участников группы
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
      console.error('Ошибка загрузки участников группы:', error);
      setGroupMembers([]);
    }
  }, [currentGroup]);

  // Реальное обновление данных в комнате станции
  useEffect(() => {
    const realtimePollingInterval = setInterval(async () => {
      if (currentScreen === 'joined' && currentGroup && isAppActiveRef.current) {
        try {
          await loadGroupMembers(currentGroup.station);
        } catch (error) {
          console.error('Ошибка обновления данных:', error);
        }
      }
    }, 3000); // Увеличили интервал до 3 секунд
    
    return () => clearInterval(realtimePollingInterval);
  }, [currentScreen, currentGroup, loadGroupMembers]);

  // Сохранение состояний в localStorage при изменениях
  useEffect(() => {
    if (isSessionRestoring || sessionRestoreInProgressRef.current) {
      return;
    }

    localStorage.setItem('selectedCity', selectedCity);
    localStorage.setItem('selectedGender', selectedGender);
    localStorage.setItem('nickname', nickname);
    localStorage.setItem('clothingColor', clothingColor);
    localStorage.setItem('wagonNumber', wagonNumber);
    localStorage.setItem('selectedStation', currentSelectedStation || '');
    localStorage.setItem('currentScreen', currentScreen);
    
    if (currentGroup) {
      localStorage.setItem('currentGroup', JSON.stringify(currentGroup));
    }
    
    if (userIdRef.current) {
      const sessionState = {
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
      };
      
      saveSessionState(sessionState);
    }
  }, [
    selectedCity, selectedGender, nickname, clothingColor,
    wagonNumber, currentSelectedStation, currentScreen, currentGroup,
    isSessionRestoring, deviceId
  ]);

  // Обновление состояния пользователя при изменении позиции или настроения
  useEffect(() => {
    if (userIdRef.current && (selectedPosition || selectedMood)) {
      const timeoutId = setTimeout(() => {
        updateUserState();
      }, 500);
      
      return () => clearTimeout(timeoutId);
    }
  }, [selectedPosition, selectedMood]);

  // Валидация никнейма
  const validateNickname = () => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setNicknameError(true);
      
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Пожалуйста, введите ваш никнейм'
      });
      
      return false;
    }
    
    setNicknameError(false);
    return true;
  };

  // Валидация цвета одежды
  const validateClothingColor = () => {
    const trimmedColor = clothingColor.trim();
    if (!trimmedColor) {
      setClothingColorError(true);
      
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Пожалуйста, укажите цвет верхней одежды или стиль'
      });
      
      return false;
    }
    
    setClothingColorError(false);
    return true;
  };

  // Валидация выбора станции
  const validateStation = () => {
    if (!currentSelectedStation) {
      setStationError(true);
      
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Пожалуйста, выберите станцию на карте'
      });
      
      return false;
    }
    
    setStationError(false);
    return true;
  };

  // Сброс ошибки при изменении никнейма
  const handleNicknameChange = (e) => {
    setNickname(e.target.value);
    if (nicknameError) {
      setNicknameError(false);
    }
  };

  // Сброс ошибки при изменении цвета одежды
  const handleClothingColorChange = (e) => {
    setClothingColor(e.target.value);
    if (clothingColorError) {
      setClothingColorError(false);
    }
  };

  // Сброс ошибки при выборе станции
  const handleStationSelect = (stationName) => {
    setCurrentSelectedStation(stationName);
    if (stationError) {
      setStationError(false);
    }
  };

  // Оптимизированный вход в комнату ожидания
  const handleEnterWaitingRoom = async () => {
    if (!validateNickname()) {
      return;
    }
    
    setIsLoading(true);
    isSettingUpRef.current = true;

    try {
      await checkAndCleanDuplicates();
      
      const users = await api.getUsers();
      const trimmedNickname = nickname.trim();
      
      const existingDeviceSession = users.find(user => 
        user.device_id === deviceId && 
        user.online === true
      );
      
      const existingNicknameSession = users.find(user => 
        user.name === trimmedNickname && 
        user.online === true &&
        user.id !== userIdRef.current
      );
      
      let createdUser;
      
      if (existingDeviceSession) {
        // Используем существующую сессию с этого устройства
        const newSessionId = generateSessionId(deviceId);
        createdUser = await api.updateUser(existingDeviceSession.id, {
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
        
        userIdRef.current = existingDeviceSession.id;
        sessionIdRef.current = newSessionId;
        
      } else {
        // Создаем нового пользователя
        if (existingNicknameSession) {
          await api.updateUser(existingNicknameSession.id, {
            online: false,
            is_connected: false,
            is_waiting: false,
            status: 'Сессия заменена'
          });
        }
        
        const newSessionId = generateSessionId(deviceId);
        const userData = {
          name: trimmedNickname,
          station: '',
          wagon: '',
          color: '',
          colorCode: helpers.getRandomColor(),
          status: 'В режиме ожидания',
          timer: "00:00",
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

        createdUser = await api.createUser(userData);
        
        if (createdUser && createdUser.id) {
          userIdRef.current = createdUser.id;
          sessionIdRef.current = newSessionId;
        } else {
          throw new Error('Не удалось создать пользователя');
        }
      }
      
      if (createdUser) {
        saveSessionState({
          userId: userIdRef.current,
          nickname: trimmedNickname,
          selectedCity,
          selectedGender,
          clothingColor,
          wagonNumber,
          currentSelectedStation,
          deviceId: deviceId,
          currentScreen: 'waiting',
          timestamp: Date.now()
        });
        
        setCurrentScreen('waiting');
        await loadStationsMap();

        bridge.send("VKWebAppShowSnackbar", {
          text: '✅ Профиль создан успешно'
        });
      }
    } catch (error) {
      console.error('❌ ОШИБКА в handleEnterWaitingRoom:', error);
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Ошибка создания сессии'
      });
    } finally {
      setIsLoading(false);
      isSettingUpRef.current = false;
    }
  };

  // Подтверждение выбора станции
  const handleConfirmStation = async () => {
    if (!validateClothingColor()) {
      return;
    }
    
    if (!validateStation()) {
      return;
    }

    if (!userIdRef.current) {
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Ошибка: сначала создайте профиль'
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
        session_id: sessionIdRef.current,
        device_id: deviceId,
        last_seen: new Date().toISOString(),
        status: 'Выбрал станцию: ' + currentSelectedStation
      });

      // Оптимизированная загрузка группы
      const users = await api.getUsers();
      const stationUsers = users.filter(user => 
        user.station === currentSelectedStation && 
        user.is_connected === true &&
        user.online === true
      );
      
      const groupData = {
        station: currentSelectedStation,
        users: stationUsers
      };
      
      setCurrentGroup(groupData);
      setCurrentScreen('joined');
      
      saveSessionState({
        userId: userIdRef.current,
        nickname: nickname.trim(),
        selectedCity,
        selectedGender,
        clothingColor: clothingColor.trim(),
        wagonNumber,
        currentSelectedStation,
        deviceId: deviceId,
        currentScreen: 'joined',
        timestamp: Date.now()
      });
      
      bridge.send("VKWebAppShowSnackbar", {
        text: `✅ Вы присоединились к станции ${currentSelectedStation}`
      });
      
      // Используем useCallback функцию
      await loadGroupMembers(currentSelectedStation);
      
    } catch (error) {
      console.error('Ошибка при обновлении параметров:', error);
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Ошибка: ' + (error.message || 'Неизвестная ошибка')
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
          status: 'Ожидание',
          is_waiting: true,
          is_connected: false,
          station: '',
          session_id: sessionIdRef.current,
          device_id: deviceId,
          last_seen: new Date().toISOString()
        });
      } catch (error) {
        console.error('Ошибка при обновлении пользователя:', error);
      }
    }
    
    setCurrentGroup(null);
    setCurrentScreen('waiting');
    setSelectedPosition('');
    setSelectedMood('');
    
    bridge.send("VKWebAppShowSnackbar", {
      text: 'Вы вышли из комнаты станции'
    });
  };

  // Генерация статуса пользователя
  const generateUserStatus = () => {
    const positionPart = selectedPosition ? selectedPosition : '';
    const moodPart = selectedMood ? selectedMood : '';
    
    if (positionPart && moodPart) {
      return `${positionPart} | ${moodPart}`;
    } else if (positionPart || moodPart) {
      return positionPart || moodPart;
    } else {
      return 'Ожидание';
    }
  };

  // Обработчики выбора
  const handleCitySelect = (city) => setSelectedCity(city);
  const handleGenderSelect = (gender) => setSelectedGender(gender);
  const handlePositionSelect = (position) => {
    const previousPosition = selectedPosition;
    setSelectedPosition(position);
    
    userActivityRef.current = Date.now();
    setLastActivityTime(Date.now());
    
    if (previousPosition !== position) {
      updateUserState();
    }
  };

  const handleMoodSelect = (mood) => {
    const previousMood = selectedMood;
    setSelectedMood(mood);
    
    userActivityRef.current = Date.now();
    setLastActivityTime(Date.now());
    
    if (previousMood !== mood) {
      updateUserState();
    }
  };

  // Обновление состояния пользователя
  const updateUserState = async () => {
    if (!userIdRef.current) return;
    
    try {
      const newStatus = generateUserStatus();
      await api.updateUser(userIdRef.current, { 
        status: newStatus,
        position: selectedPosition,
        mood: selectedMood,
        session_id: sessionIdRef.current,
        device_id: deviceId,
        last_seen: new Date().toISOString()
      });
      
      // Обновляем локальное состояние
      setGroupMembers(prevMembers => 
        prevMembers.map(member => 
          member.id === userIdRef.current 
            ? { 
                ...member, 
                status: newStatus,
                position: selectedPosition,
                mood: selectedMood
              }
            : member
        )
      );
    } catch (error) {
      console.error('❌ Ошибка обновления состояния:', error);
    }
  };

  // Пинг активности
  const improvedPingActivity = async () => {
    if (!userIdRef.current || !isAppActiveRef.current) return false;
    
    const now = Date.now();
    if (now - lastPingTime < PING_INTERVAL) return false;
    
    try {
      const updateData = { 
        online: true,
        is_connected: currentScreen === 'joined',
        session_id: sessionIdRef.current,
        device_id: deviceId,
        last_seen: new Date().toISOString(),
        ...(currentScreen === 'joined' && currentGroup && { 
          station: currentGroup.station 
        })
      };
      
      await api.pingActivity(userIdRef.current, updateData);
      setLastPingTime(now);
      
      return true;
    } catch (error) {
      console.error('Ошибка пинга активности:', error);
      return false;
    }
  };

  // Навигация
  const showSetup = () => setCurrentScreen('setup');
  const showWaitingRoom = () => {
    if (!userIdRef.current) {
      if (!validateNickname()) {
        return;
      }
      bridge.send("VKWebAppShowSnackbar", {
        text: 'Сначала создайте профиль'
      });
      return;
    }
    setCurrentScreen('waiting');
  };

  const showJoinedRoom = () => {
    if (!currentGroup) {
      bridge.send("VKWebAppShowSnackbar", {
        text: 'Сначала выберите станцию'
      });
      return;
    }
    setCurrentScreen('joined');
  };

  // Оптимизированный рендер карты станций
  const renderStationsMap = useCallback(() => {
    const { stationStats } = stationsData;
    
    if (!stationStats || stationStats.length === 0) {
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
      
      const totalCount = waitingCount + connectedCount;
      const isSelected = currentSelectedStation === stationName;
      
      return (
        <div 
          key={stationName}
          className={`station-map-item ${stationClass} ${isSelected ? 'selected' : ''}`}
          onClick={() => handleStationSelect(stationName)}
        >
          <div className="station-name">{stationName}</div>
          {totalCount > 0 ? (
            <div className="station-counts">
              {waitingCount > 0 && <span className="station-count count-waiting">{waitingCount}⏳</span>}
              {connectedCount > 0 && <span className="station-count count-connected">{connectedCount}✅</span>}
            </div>
          ) : (
            <div style={{fontSize: '10px', color: '#666'}}>Пусто</div>
          )}
        </div>
      );
    });
  }, [stationsData, selectedCity, currentSelectedStation]);

  // Оптимизированный рендер участников группы
  const renderGroupMembers = useCallback(() => {
    if (groupMembers.length === 0) {
      return <div className="no-requests">Нет участников на этой станции</div>;
    }
    
    return groupMembers.map(user => {
      const isCurrentUser = userIdRef.current && user.id === userIdRef.current;
      
      let additionalInfo = '';
      if (user.color) additionalInfo += `🎨 ${user.color}`;
      if (user.wagon && user.wagon !== '' && user.wagon !== 'Не указан') {
        if (additionalInfo) additionalInfo += ' • ';
        additionalInfo += `🚇 Вагон ${user.wagon}`;
      }
      
      return (
        <div key={user.id} className={`user-state-display ${isCurrentUser ? 'current-user' : ''}`}>
          <div className="user-avatar" style={{background: user.color_code || '#007bff'}}>
            {user.name.charAt(0)}
          </div>
          <div className="user-state-info">
            <div className="user-state-name">{user.name} {isCurrentUser ? '(Вы)' : ''}</div>
            <div className="user-state-details">
              {(user.position || user.mood) && (
                <div>
                  {user.position && <span className="state-highlight">{user.position}</span>}
                  {user.position && user.mood && ' • '}
                  {user.mood && <span className="state-highlight">{user.mood}</span>}
                </div>
              )}
              {additionalInfo && (
                <div style={{marginTop: '5px', fontSize: '12px', color: '#666'}}>
                  {additionalInfo}
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
          <h3 className="loader-title"></h3>
          <div className="loader-box">
            <div className="loader-1" id="neuromorphic-loader">
              <div className="neuromorphic-circle"></div>
            </div>
            {isSessionRestoring && (
              <div style={{textAlign: 'center', marginTop: '10px'}}>
                Восстановление сессии...
              </div>
            )}
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
              <div className="navigation-buttons">
                <button className="nav-btn active">1. Настройка</button>
                <button className="nav-btn" onClick={showWaitingRoom}>2. Выбор станции</button>
                <button className="nav-btn" onClick={showJoinedRoom}>3. Комната станции</button>
              </div>
              <p>Укажите ваш город и пол</p>
              
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
                  ref={nicknameInputRef}
                  type="text" 
                  id="nickname-input" 
                  placeholder="Придумайте уникальное имя" 
                  value={nickname}
                  onChange={handleNicknameChange}
                  className={nicknameError ? 'error-input' : ''}
                  required 
                />
                <small className="field-hint" style={{ color: nicknameError ? '#ff4444' : '' }}>
                  {nicknameError ? '❌ Это поле обязательно для заполнения' : 'Это имя будет видно другим участникам'}
                </small>
              </div>
              
              <div className="form-group">
                <label>Выберите город:</label>
                <div className="city-options">
                  <div 
                    className={`city-option moscow ${selectedCity === 'moscow' ? 'active' : ''}`}
                    onClick={() => handleCitySelect('moscow')}
                  >
                    <div className="city-name">Москва</div>
                    <div className="city-description">Московский метрополитен</div>
                  </div>
                  <div 
                    className={`city-option spb ${selectedCity === 'spb' ? 'active' : ''}`}
                    onClick={() => handleCitySelect('spb')}
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
                    onClick={() => handleGenderSelect('male')}
                  >
                    Мужской
                  </div>
                  <div 
                    className={`gender-option ${selectedGender === 'female' ? 'active' : ''}`}
                    onClick={() => handleGenderSelect('female')}
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
                style={{
                  backgroundColor: nicknameError ? '#ff4444' : '',
                  borderColor: nicknameError ? '#ff4444' : ''
                }}
              >
                {isLoading ? 'Создание профиля...' : 'Войти в комнату ожидания'}
              </button>
            </div>
          )}

          {currentScreen === 'waiting' && (
            <div id="waiting-room-screen" className="screen">
              <button className="back-btn" onClick={showSetup}>
                <i>←</i> Изменить параметры
              </button>
              
              <h2>Комната ожидания</h2>
              <div className="navigation-buttons">
                <button className="nav-btn" onClick={showSetup}>1. Настройка</button>
                <button className="nav-btn active">2. Выбор станции</button>
                <button className="nav-btn" onClick={showJoinedRoom}>3. Комната станции</button>
              </div>
              
              <p style={{fontSize: '12px'}}> 🔴 Выберите станцию на карте для присоединения </p>
              <p style={{fontSize: '12px'}}> 🔴 Цвет верхней одежды или стиль </p>
              <p style={{fontSize: '12px'}}> 🔴 Номер вагона (если в пути)</p>
              
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
                
                <div 
                  ref={metroMapRef}
                  className="metro-map" 
                  id="metro-map"
                >
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
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                    <option value="6">6</option>
                    <option value="7">7</option>
                    <option value="8">8</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label htmlFor="color-select" style={{ color: clothingColorError ? '#ff4444' : '' }}>
                    Цвет верхней одежды или стиль *
                    {clothingColorError && (
                      <span style={{ color: '#ff4444', marginLeft: '5px', fontSize: '12px' }}>
                        (обязательное поле)
                      </span>
                    )}
                  </label>
                  <input 
                    ref={clothingColorInputRef}
                    type="text" 
                    id="color-select" 
                    placeholder="Например: черный верх, синий низ, очки, шапка" 
                    value={clothingColor}
                    onChange={handleClothingColorChange}
                    required 
                  />
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
              <div className="navigation-buttons">
                <button className="nav-btn" onClick={showSetup}>1. Настройка</button>
                <button className="nav-btn" onClick={showWaitingRoom}>2. Выбор станции</button>
                <button className="nav-btn active">3. Комната станции</button>
              </div>
              
              <p>Расскажите о своем состоянии другим участникам</p>
              
              <div className="status-indicators" id="current-user-status">
                <div className="status-indicator" id="position-indicator">
                  📍 Позиция: <span id="current-position">
                    {selectedPosition || 'не выбрана'}
                  </span>
                </div>
                <div className="status-indicator" id="mood-indicator">
                  😊 Настроение: <span id="current-mood">
                    {selectedMood || 'не выбрано'}
                  </span>
                </div>
              </div>
              
              <div className="state-section">
                <h4>🎯 Ваша позиция на станции или в вагоне</h4>
                <div className="state-cards" id="position-cards">
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
                      onClick={() => handlePositionSelect(item.position)}
                    >
                      <div className="state-icon">{item.icon}</div>
                      <div className="state-name">{item.position}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="state-section">
                <h4>😊 Ваше текущее состояние</h4>
                <div className="state-cards" id="mood-cards">
                  {[
                    { mood: "Просто наблюдаю", icon: "👀" },
                    { mood: "Сплю", icon: "😴" },
                    { mood: "Хорошее настроение, улыбаюсь", icon: "😊" },
                    { mood: "Плохое настроение, грустно", icon: "😔" },
                    { mood: "Жду когда ко мне подойдут", icon: "⏳" },
                    { mood: "Собираюсь подойти", icon: "🚶" }
                  ].map((item) => (
                    <div 
                      key={item.mood}
                      className={`state-card ${selectedMood === item.mood ? 'active' : ''}`}
                      onClick={() => handleMoodSelect(item.mood)}
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
          &copy; 2026 | Гаджи Латипов | Метрос | Санкт-Петербург
        </footer>
      </div>
    </div>
  );
};