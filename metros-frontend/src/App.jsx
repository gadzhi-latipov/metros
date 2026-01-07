import { useState, useEffect, useRef, useCallback } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';

// Генерация уникального ID устройства с улучшенным хранением
const generateDeviceId = () => {
  let deviceId = localStorage.getItem('deviceId');
  
  if (!deviceId) {
    deviceId = sessionStorage.getItem('deviceId');
  }
  
  if (!deviceId) {
    deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    localStorage.setItem('deviceId', deviceId);
    sessionStorage.setItem('deviceId', deviceId);
    console.log('🆕 Создан новый deviceId:', deviceId);
  }
  
  return deviceId;
};

// Генерация сессии с учетом устройства
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
    sessionStorage.setItem('metro_session_state', JSON.stringify(sessionData));
    console.log('💾 Сохранено состояние сессии');
  } catch (error) {
    console.error('❌ Ошибка сохранения состояния сессии:', error);
  }
};

// Загрузка состояния сессии
const loadSessionState = () => {
  try {
    let sessionData = localStorage.getItem('metro_session_state');
    
    if (!sessionData) {
      sessionData = sessionStorage.getItem('metro_session_state');
    }
    
    if (sessionData) {
      const parsed = JSON.parse(sessionData);
      const now = Date.now();
      
      if (now - parsed.timestamp < 30 * 60 * 1000) {
        console.log('📂 Загружено сохраненное состояние сессии');
        return parsed;
      } else {
        console.log('🕒 Состояние сессии устарело');
        clearSessionState();
      }
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки состояния сессии:', error);
  }
  
  return null;
};

// Очистка состояния сессии
const clearSessionState = () => {
  localStorage.removeItem('metro_session_state');
  sessionStorage.removeItem('metro_session_state');
  console.log('🧹 Очищено состояние сессии');
};

// Функция для установки пользователя в оффлайн
const setUserOffline = async (userId, sessionId, deviceId) => {
  if (!userId) return;
  
  try {
    console.log('👋 Устанавливаем пользователя в оффлайн:', userId);
    await api.updateUser(userId, { 
      online: false,
      is_connected: false,
      is_waiting: false,
      last_seen: new Date().toISOString(),
      session_id: sessionId,
      device_id: deviceId,
      status: 'Оффлайн'
    });
    console.log('✅ Пользователь успешно установлен в оффлайн');
  } catch (error) {
    console.error('❌ Ошибка установки пользователя в оффлайн:', error);
  }
};

// Функция для вычисления статистики станций
const calculateStationsStats = (users, city) => {
  try {
    console.log('📊 Вычисляем статистику станций для города:', city);
    console.log('👥 Всего пользователей:', users.length);
    
    const stationStats = {};
    let total_connected = 0;
    let total_waiting = 0;
    
    // Получаем список станций для выбранного города
    const cityStations = helpers.stations[city] || [];
    
    // Инициализируем все станции города
    cityStations.forEach(station => {
      stationStats[station] = {
        station: station,
        waiting: 0,
        connected: 0,
        totalUsers: 0
      };
    });
    
    // Подсчитываем пользователей по станциям
    users.forEach(user => {
      // Проверяем, что пользователь онлайн
      if (user.online !== true) return;
      
      if (user.is_waiting && !user.is_connected) {
        // Пользователь в режиме ожидания
        total_waiting++;
      } else if (user.is_connected && user.station) {
        // Пользователь на станции
        total_connected++;
        
        // Если станция есть в списке станций города
        if (stationStats[user.station]) {
          stationStats[user.station].connected++;
          stationStats[user.station].totalUsers++;
        } else {
          // Если станции нет в списке, но пользователь на ней
          console.log('⚠️ Станция не найдена в списке города:', user.station);
        }
      }
    });
    
    // Преобразуем объект в массив
    const stationStatsArray = Object.values(stationStats);
    
    console.log('📈 Статистика рассчитана:', {
      totalStations: stationStatsArray.length,
      totalConnected: total_connected,
      totalWaiting: total_waiting,
      stationsWithUsers: stationStatsArray.filter(s => s.totalUsers > 0).length
    });
    
    return {
      stationStats: stationStatsArray,
      totalStats: {
        total_connected,
        total_waiting,
        total_users: total_connected + total_waiting
      }
    };
  } catch (error) {
    console.error('❌ Ошибка расчета статистики станций:', error);
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
  const [selectedCity, setSelectedCity] = useState('spb');
  const [selectedGender, setSelectedGender] = useState('male');
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
  const [isColdStart, setIsColdStart] = useState(true);
  const [inactivityTimer, setInactivityTimer] = useState(30 * 60 * 1000); // 30 минут по умолчанию
  
  const CACHE_DURATION = 10000;
  const PING_INTERVAL = 15000;
  const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 минут бездействия
  const SHORT_INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 минут для скрытия приложения

  const userIdRef = useRef(null);
  const globalRefreshIntervalRef = useRef(null);
  const sessionIdRef = useRef('');
  const vkUserIdRef = useRef(null);
  const nicknameInputRef = useRef(null);
  const clothingColorInputRef = useRef(null);
  const metroMapRef = useRef(null);
  const isInitialMountRef = useRef(true);
  const sessionRestoreInProgressRef = useRef(false);
  const appVisibilityHandlerRef = useRef(null);
  const offlineTimeoutRef = useRef(null);
  const pingTimeoutRef = useRef(null);
  const inactivityTimeoutRef = useRef(null);
  const isOfflineRequestRef = useRef(false);
  const isAppActiveRef = useRef(true);
  const userActivityRef = useRef(Date.now());

  // Основная инициализация приложения
  useEffect(() => {
    console.log('✅ React компонент App загружен');
    
    // Инициализация устройства
    const generatedDeviceId = generateDeviceId();
    setDeviceId(generatedDeviceId);
    
    console.log('📱 Идентификатор устройства:', generatedDeviceId);
    
    // Инициализация VK Bridge
    bridge.send("VKWebAppInit")
      .then((data) => {
        if (data.result) {
          console.log('✅ VK Bridge инициализирован');
        } else {
          console.error('❌ Ошибка инициализации VK Bridge');
        }
      })
      .catch((error) => {
        console.error('❌ Ошибка инициализации VK Bridge:', error);
      });

    // Упрощенный обработчик видимости страницы
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('📱 Приложение скрыто/свернуто');
        isAppActiveRef.current = false;
        setAppState('background');
        
        // Если приложение скрыто, запускаем таймер на 5 минут
        clearTimeout(offlineTimeoutRef.current);
        offlineTimeoutRef.current = setTimeout(() => {
          if (!isAppActiveRef.current && userIdRef.current) {
            console.log('⏰ 5 минут неактивности, устанавливаем в оффлайн');
            isOfflineRequestRef.current = true;
            setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
          }
        }, SHORT_INACTIVITY_TIMEOUT);
        
      } else {
        console.log('📱 Приложение активно');
        isAppActiveRef.current = true;
        setAppState('active');
        
        // Очищаем таймер оффлайн
        clearTimeout(offlineTimeoutRef.current);
        
        // Если был запрос на оффлайн, отменяем его
        isOfflineRequestRef.current = false;
        
        // Восстанавливаем сессию если нужно
        if (userIdRef.current) {
          improvedPingActivity();
        }
      }
    };

    // Таймер неактивности (30 минут)
    const checkInactivity = () => {
      const now = Date.now();
      const timeSinceLastActivity = now - userActivityRef.current;
      
      if (timeSinceLastActivity > INACTIVITY_TIMEOUT && userIdRef.current && isAppActiveRef.current) {
        console.log('⏰ 30 минут неактивности, устанавливаем в оффлайн');
        setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
      } else {
        // Повторяем проверку каждую минуту
        inactivityTimeoutRef.current = setTimeout(checkInactivity, 60000);
      }
    };

    // Запускаем таймер неактивности
    inactivityTimeoutRef.current = setTimeout(checkInactivity, 60000);

    // Подписка на события видимости страницы
    document.addEventListener('visibilitychange', handleVisibilityChange);
    appVisibilityHandlerRef.current = handleVisibilityChange;

    // Подписка на события VK Bridge
    bridge.subscribe((event) => {
      if (!event.detail) return;
      
      const { type, data } = event.detail;
      console.log('📡 VK Bridge событие:', type, data);
      
      switch (type) {
        case 'VKWebAppUpdateConfig':
          const schemeAttribute = document.createAttribute('scheme');
          schemeAttribute.value = data.scheme ? data.scheme : 'client_light';
          document.body.attributes.setNamedItem(schemeAttribute);
          break;
        case 'VKWebAppViewHide':
          console.log('📱 VKWebAppViewHide - приложение скрыто');
          setAppState('background');
          isAppActiveRef.current = false;
          
          // Если приложение скрыто, запускаем таймер на 5 минут
          clearTimeout(offlineTimeoutRef.current);
          offlineTimeoutRef.current = setTimeout(() => {
            if (!isAppActiveRef.current && userIdRef.current) {
              console.log('⏰ 5 минут неактивности, устанавливаем в оффлайн');
              isOfflineRequestRef.current = true;
              setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
            }
          }, SHORT_INACTIVITY_TIMEOUT);
          break;
        case 'VKWebAppViewRestore':
          console.log('📱 VKWebAppViewRestore - приложение восстановлено');
          setAppState('active');
          isAppActiveRef.current = true;
          
          // Очищаем таймер оффлайн
          clearTimeout(offlineTimeoutRef.current);
          isOfflineRequestRef.current = false;
          
          // При восстановлении вида VK восстанавливаем сессию
          if (userIdRef.current) {
            improvedPingActivity();
          }
          break;
        default:
          break;
      }
    });

    // Загрузка данных пользователя VK
    async function fetchUserData() {
      try {
        const user = await bridge.send('VKWebAppGetUserInfo');
        setUser(user);
        vkUserIdRef.current = user.id;
        console.log('👤 Данные пользователя VK загружены:', user.id);
      } catch (error) {
        console.error('❌ Ошибка загрузки пользователя:', error);
      }
    }
    
    fetchUserData();
    
    // Восстановление сессии пользователя
    const restoreSession = async () => {
      if (sessionRestoreInProgressRef.current) {
        console.log('🔄 Восстановление сессии уже выполняется, пропускаем');
        return;
      }
      
      sessionRestoreInProgressRef.current = true;
      setIsSessionRestoring(true);
      setRestoreAttempted(true);
      
      try {
        console.log('🔄 Начинаем восстановление сессии...');
        
        // Пытаемся загрузить сохраненное состояние
        const savedState = loadSessionState();
        
        if (savedState) {
          console.log('📂 Используем сохраненное состояние сессии');
          
          // Восстанавливаем состояние из сохраненных данных
          await restoreFromSavedState(savedState, generatedDeviceId);
        } else {
          console.log('🆕 Нет сохраненного состояния, начинаем с сервера');
          
          // Пытаемся восстановить с сервера
          await checkAndRestoreSession(generatedDeviceId);
        }
      } catch (error) {
        console.error('❌ Критическая ошибка восстановления сессии:', error);
        // При ошибке показываем setup
        setCurrentScreen('setup');
      } finally {
        setIsSessionRestoring(false);
        sessionRestoreInProgressRef.current = false;
        setIsColdStart(false);
      }
    };
    
    restoreSession();
    
    // Запуск глобального обновления
    const cleanupGlobalRefresh = startGlobalRefresh();

    // Очистка при размонтировании
    return () => {
      cleanupGlobalRefresh();
      
      if (globalRefreshIntervalRef.current) {
        clearInterval(globalRefreshIntervalRef.current);
      }
      
      // Очищаем все таймеры
      clearTimeout(offlineTimeoutRef.current);
      clearTimeout(pingTimeoutRef.current);
      clearTimeout(inactivityTimeoutRef.current);
      
      // Удаляем обработчики событий видимости
      if (appVisibilityHandlerRef.current) {
        document.removeEventListener('visibilitychange', appVisibilityHandlerRef.current);
      }
      
      // Устанавливаем пользователя в оффлайн при размонтировании
      if (userIdRef.current && isAppActiveRef.current) {
        setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
      }
    };
  }, []);

  // Восстановление из сохраненного состояния
  const restoreFromSavedState = async (savedState, deviceId) => {
    try {
      console.log('🔄 Восстанавливаем из сохраненного состояния:', savedState);
      
      // Восстанавливаем локальное состояние
      if (savedState.nickname) setNickname(savedState.nickname);
      if (savedState.selectedCity) setSelectedCity(savedState.selectedCity);
      if (savedState.selectedGender) setSelectedGender(savedState.selectedGender);
      if (savedState.clothingColor) setClothingColor(savedState.clothingColor);
      if (savedState.wagonNumber) setWagonNumber(savedState.wagonNumber);
      if (savedState.currentSelectedStation) setCurrentSelectedStation(savedState.currentSelectedStation);
      
      // Устанавливаем userId если есть
      if (savedState.userId) {
        userIdRef.current = savedState.userId;
      }
      
      // Проверяем сессию на сервере
      const users = await api.getUsers();
      const serverSession = users.find(user => 
        user.id === savedState.userId &&
        user.device_id === deviceId
      );
      
      if (serverSession && serverSession.online !== false) {
        // Сессия существует на сервере
        console.log('✅ Сессия найдена на сервере, продолжаем восстановление');
        
        // Обновляем сессию
        const newSessionId = generateSessionId(deviceId);
        sessionIdRef.current = newSessionId;
        
        await api.updateUser(serverSession.id, {
          session_id: newSessionId,
          online: true,
          last_seen: new Date().toISOString(),
          device_id: deviceId
        });
        
        // Загружаем данные станций
        await loadStationsMap();
        
        // Восстанавливаем экран
        if (serverSession.is_connected && serverSession.station) {
          // Восстанавливаем комнату станции
          setCurrentScreen('joined');
          
          const groupData = {
            station: serverSession.station,
            users: []
          };
          
          setCurrentGroup(groupData);
          
          // Загружаем участников
          setTimeout(async () => {
            await loadGroupMembers(serverSession.station);
            await loadRequests();
          }, 300);
          
        } else if (serverSession.is_waiting) {
          // Восстанавливаем комнату ожидания
          setCurrentScreen('waiting');
          
          // Загружаем данные
          await loadRequests();
        } else {
          // Непонятное состояние - показываем настройки
          setCurrentScreen('setup');
        }
      } else {
        // Сессии нет на сервере или она оффлайн, начинаем заново
        console.log('❌ Сессия не найдена на сервере или оффлайн, начинаем заново');
        setCurrentScreen('setup');
        clearSessionState();
      }
      
    } catch (error) {
      console.error('❌ Ошибка восстановления из сохраненного состояния:', error);
      setCurrentScreen('setup');
    }
  };

  // Проверка и восстановление сессии с сервера
  const checkAndRestoreSession = async (deviceId) => {
    try {
      console.log('🔍 Ищем активные сессии для устройства:', deviceId);
      
      const users = await api.getUsers();
      const now = Date.now();
      
      // 1. Ищем самую свежую сессию для этого устройства
      const deviceSessions = users.filter(user => 
        user.device_id === deviceId
      );
      
      console.log(`📊 Найдено сессий для устройства ${deviceId}:`, deviceSessions.length);
      
      if (deviceSessions.length === 0) {
        console.log('🆕 Нет сессий для этого устройства, начинаем с настройки');
        setCurrentScreen('setup');
        return;
      }
      
      // Сортируем сессии по времени последнего обновления (новые сначала)
      deviceSessions.sort((a, b) => {
        const timeA = a.last_seen ? new Date(a.last_seen).getTime() : 0;
        const timeB = b.last_seen ? new Date(b.last_seen).getTime() : 0;
        return timeB - timeA;
      });
      
      const latestSession = deviceSessions[0];
      console.log('🎯 Самая свежая сессия:', latestSession.id, latestSession.name);
      
      // Проверяем, активна ли сессия (последнее обновление было не более 10 минут назад)
      const lastSeenTime = latestSession.last_seen ? new Date(latestSession.last_seen).getTime() : 0;
      const isSessionActive = (now - lastSeenTime) < 10 * 60 * 1000; // 10 минут
      
      if (isSessionActive && latestSession.online !== false) {
        console.log('✅ Найдена активная сессия, восстанавливаем:', latestSession.id);
        userIdRef.current = latestSession.id;
        
        // Генерируем новую сессию
        const newSessionId = generateSessionId(deviceId);
        sessionIdRef.current = newSessionId;
        
        // Деактивируем все другие сессии с этого устройства
        await deactivateOtherDeviceSessions(deviceId, latestSession.id);
        
        // Восстанавливаем состояние
        await restoreUserSession(latestSession);
        
        // Сохраняем состояние
        saveSessionState({
          userId: latestSession.id,
          nickname: latestSession.name,
          selectedCity: latestSession.city,
          selectedGender: latestSession.gender,
          clothingColor: latestSession.color,
          wagonNumber: latestSession.wagon,
          currentSelectedStation: latestSession.station,
          currentScreen: latestSession.is_connected ? 'joined' : 'waiting'
        });
        
        // Обновляем сессию на сервере
        await api.updateUser(latestSession.id, {
          session_id: newSessionId,
          online: true,
          last_seen: new Date().toISOString(),
          device_id: deviceId
        });
        
        console.log('🔄 Сессия успешно восстановлена с сервера');
      } else {
        console.log('🕒 Сессия неактивна или устарела');
        
        // Деактивируем все сессии с этого устройства
        await deactivateAllDeviceSessions(deviceId);
        
        // Очищаем сохраненное состояние
        clearSessionState();
        
        // Начинаем с настройки
        setCurrentScreen('setup');
      }
      
    } catch (error) {
      console.error('❌ Ошибка проверки сессии:', error);
      setCurrentScreen('setup');
    }
  };

  // Деактивация других сессий с этого устройства
  const deactivateOtherDeviceSessions = async (deviceId, currentSessionId) => {
    try {
      const users = await api.getUsers();
      const otherSessions = users.filter(user => 
        user.device_id === deviceId && 
        user.id !== currentSessionId &&
        user.online === true
      );
      
      console.log(`🧹 Деактивируем ${otherSessions.length} других сессий с устройства ${deviceId}`);
      
      for (const session of otherSessions) {
        try {
          await api.updateUser(session.id, {
            online: false,
            is_connected: false,
            is_waiting: false,
            status: 'Сессия деактивирована',
            last_seen: new Date().toISOString()
          });
          console.log(`✅ Деактивирована сессия: ${session.id}`);
        } catch (error) {
          console.error(`❌ Ошибка деактивации сессии ${session.id}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Ошибка деактивации других сессий:', error);
    }
  };

  // Деактивация всех сессий с устройства
  const deactivateAllDeviceSessions = async (deviceId) => {
    try {
      const users = await api.getUsers();
      const deviceSessions = users.filter(user => 
        user.device_id === deviceId &&
        user.online === true
      );
      
      console.log(`🧹 Деактивируем все (${deviceSessions.length}) сессии с устройства ${deviceId}`);
      
      for (const session of deviceSessions) {
        try {
          await api.updateUser(session.id, {
            online: false,
            is_connected: false,
            is_waiting: false,
            status: 'Сессия деактивирована',
            last_seen: new Date().toISOString()
          });
        } catch (error) {
          console.error(`❌ Ошибка деактивации сессии ${session.id}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Ошибка деактивации всех сессий:', error);
    }
  };

  // Восстановление сессии пользователя
  const restoreUserSession = async (userData) => {
    try {
      console.log('🔄 Восстанавливаем состояние пользователя:', userData);
      
      // Восстанавливаем данные из профиля
      setNickname(userData.name || '');
      setSelectedCity(userData.city || 'spb');
      setSelectedGender(userData.gender || 'male');
      setSelectedPosition(userData.position || '');
      setSelectedMood(userData.mood || '');
      setClothingColor(userData.color || '');
      setWagonNumber(userData.wagon || '');
      setSelectedMinutes(userData.timer_minutes || 5);
      
      if (userData.is_connected && userData.station) {
        // Пользователь был в комнате станции
        console.log('🚇 Восстанавливаем комнату станции:', userData.station);
        
        setCurrentSelectedStation(userData.station);
        
        // Загружаем данные станции
        await loadStationsMap();
        
        // Создаем группу
        const groupData = {
          station: userData.station,
          users: []
        };
        
        setCurrentGroup(groupData);
        
        // Загружаем участников группы
        await loadGroupMembers(userData.station);
        
        // Переходим в комнату станции
        setTimeout(() => {
          setCurrentScreen('joined');
          console.log('✅ Восстановлена сессия в комнате станции:', userData.station);
        }, 100);
        
      } else if (userData.is_waiting) {
        // Пользователь был в режиме ожидания
        console.log('⏳ Восстанавливаем комнату ожидания');
        
        setCurrentScreen('waiting');
        
        // Загружаем данные
        await loadStationsMap();
        
        console.log('✅ Восстановлена сессия в комнате ожидания');
      } else {
        // Непонятное состояние - показываем настройки
        console.log('❓ Неизвестное состояние, показываем настройки');
        setCurrentScreen('setup');
      }
    } catch (error) {
      console.error('❌ Ошибка восстановления сессии:', error);
      setCurrentScreen('setup');
    }
  };

  // Запуск глобального обновления
  const startGlobalRefresh = () => {
    const interval = setInterval(async () => {
      try {
        if (currentScreen === 'waiting') {
          await loadStationsMap();
          await loadRequests();
        } else if (currentScreen === 'joined' && currentGroup) {
          await loadGroupMembers(currentGroup.station);
          await loadRequests();
        }
        await improvedPingActivity();
      } catch (error) {
        console.error('❌ Ошибка глобального обновления:', error);
      }
    }, 10000);
    
    globalRefreshIntervalRef.current = interval;
    return () => clearInterval(interval);
  };

  // Загрузка статистики станций
  const loadStationsMap = async () => {
    try {
      console.log('🗺️ Загрузка статистики станций для города:', selectedCity);
      
      // Получаем всех пользователей
      const users = await api.getUsers();
      
      // Рассчитываем статистику локально
      const stats = calculateStationsStats(users, selectedCity);
      
      // Обновляем состояние
      setStationsData(stats);
      
      // Также обновляем allUsers
      const activeUsers = users.filter(user => user.online === true);
      setAllUsers(activeUsers);
      setUsersCache(activeUsers);
      setCacheTimestamp(Date.now());
      
      console.log('✅ Статистика загружена:', {
        stations: stats.stationStats.length,
        connected: stats.totalStats.total_connected,
        waiting: stats.totalStats.total_waiting,
        total: stats.totalStats.total_users
      });
      
      return stats;
    } catch (error) {
      console.error('❌ Ошибка загрузки карты станций:', error);
      // Устанавливаем пустые данные при ошибке
      const emptyStats = {
        stationStats: [],
        totalStats: { total_connected: 0, total_waiting: 0, total_users: 0 }
      };
      setStationsData(emptyStats);
      return emptyStats;
    }
  };

  // Загрузка участников группы
  const loadGroupMembers = async (station = null) => {
    const targetStation = station || (currentGroup ? currentGroup.station : null);
    
    if (!targetStation) {
      setGroupMembers([]);
      return;
    }
    
    try {
      const users = await api.getUsers();
      
      // Фильтруем пользователей на станции
      const groupUsers = users.filter(user => {
        const isOnStation = user.station === targetStation && user.is_connected === true;
        
        // Если это текущий пользователь, проверяем его статус
        if (userIdRef.current && user.id === userIdRef.current) {
          return isOnStation && user.online === true;
        }
        
        return isOnStation && user.online === true;
      });
      
      console.log(`👥 Загружено участников группы для станции ${targetStation}:`, groupUsers.length);
      setGroupMembers(groupUsers);
    } catch (error) {
      console.error('Ошибка загрузки участников группы:', error);
      setGroupMembers([]);
    }
  };

  // Загрузка всех пользователей
  const loadRequests = async (forceRefresh = false) => {
    const now = Date.now();
    
    if (!forceRefresh && usersCache && (now - cacheTimestamp) < CACHE_DURATION) {
      setAllUsers(usersCache);
      return usersCache;
    }
    
    try {
      const users = await api.getUsers();
      // Фильтруем только активных пользователей
      const activeUsers = users.filter(user => user.online === true);
      setAllUsers(activeUsers);
      setUsersCache(activeUsers);
      setCacheTimestamp(now);
      return activeUsers;
    } catch (error) {
      console.error('Ошибка загрузки запросов:', error);
      return usersCache || [];
    }
  };

  // Реальное обновление данных в комнате станции
  useEffect(() => {
    const realtimePollingInterval = setInterval(async () => {
      if (currentScreen === 'joined' && currentGroup && isAppActiveRef.current) {
        try {
          // Загружаем актуальных участников
          const users = await api.getUsers();
          const freshGroupMembers = users.filter(user => 
            user.station === currentGroup.station && 
            user.is_connected === true &&
            user.online === true
          );
          
          // Обновляем только если есть изменения
          setGroupMembers(prevMembers => {
            const prevIds = prevMembers.map(u => u.id).sort();
            const newIds = freshGroupMembers.map(u => u.id).sort();
            
            if (JSON.stringify(prevIds) !== JSON.stringify(newIds)) {
              console.log('🔄 Обновлен состав участников группы');
              return freshGroupMembers;
            }
            
            // Проверяем изменения статусов
            const hasStatusChanges = prevMembers.some(prevUser => {
              const newUser = freshGroupMembers.find(u => u.id === prevUser.id);
              return newUser && (
                newUser.status !== prevUser.status ||
                newUser.position !== prevUser.position ||
                newUser.mood !== prevUser.mood
              );
            });
            
            if (hasStatusChanges) {
              console.log('🔄 Обновлены статусы участников группы');
              return freshGroupMembers;
            }
            
            return prevMembers;
          });
          
          // Обновляем статистику станций
          await loadStationsMap();
          
        } catch (error) {
          console.error('Ошибка обновления данных:', error);
        }
      }
    }, 2000);
    
    return () => clearInterval(realtimePollingInterval);
  }, [currentScreen, currentGroup]);

  // Обработка онлайн/офлайн статуса
  useEffect(() => {
    const handleOnline = async () => {
      console.log('🌐 Интернет восстановлен');
      setIsOnline(true);
      
      // Если был в joined, восстанавливаем сессию
      if (userIdRef.current && (currentScreen === 'joined' || currentScreen === 'waiting')) {
        try {
          await api.updateUser(userIdRef.current, {
            online: true,
            last_seen: new Date().toISOString(),
            session_id: sessionIdRef.current,
            device_id: deviceId
          });
          console.log('✅ Сессия восстановлена после потери соединения');
          
          // Обновляем данные
          if (currentScreen === 'joined') {
            await loadGroupMembers();
            await loadRequests(true);
          } else if (currentScreen === 'waiting') {
            await loadStationsMap();
            await loadRequests();
          }
        } catch (error) {
          console.error('❌ Ошибка восстановления сессии:', error);
        }
      }
    };
    
    const handleOffline = () => {
      console.log('🌐 Потеряно интернет-соединение');
      setIsOnline(false);
      
      // При потере соединения помечаем пользователя как оффлайн
      if (userIdRef.current && !isOfflineRequestRef.current) {
        isOfflineRequestRef.current = true;
        setUserOffline(userIdRef.current, sessionIdRef.current, deviceId);
      }
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [currentScreen, currentGroup, deviceId]);

  // Сохранение состояний в localStorage и sessionStorage при изменениях
  useEffect(() => {
    // Сохраняем в localStorage для долгосрочного хранения
    localStorage.setItem('selectedCity', selectedCity);
    localStorage.setItem('selectedGender', selectedGender);
    localStorage.setItem('selectedPosition', selectedPosition);
    localStorage.setItem('selectedMood', selectedMood);
    localStorage.setItem('selectedStation', currentSelectedStation);
    localStorage.setItem('selectedTimerMinutes', selectedMinutes);
    localStorage.setItem('nickname', nickname);
    localStorage.setItem('clothingColor', clothingColor);
    localStorage.setItem('wagonNumber', wagonNumber);
    localStorage.setItem('currentScreen', currentScreen);
    
    // Также сохраняем в sessionStorage для быстрого восстановления
    sessionStorage.setItem('selectedCity', selectedCity);
    sessionStorage.setItem('selectedGender', selectedGender);
    sessionStorage.setItem('selectedPosition', selectedPosition);
    sessionStorage.setItem('selectedMood', selectedMood);
    sessionStorage.setItem('selectedStation', currentSelectedStation);
    sessionStorage.setItem('selectedTimerMinutes', selectedMinutes);
    sessionStorage.setItem('nickname', nickname);
    sessionStorage.setItem('clothingColor', clothingColor);
    sessionStorage.setItem('wagonNumber', wagonNumber);
    sessionStorage.setItem('currentScreen', currentScreen);
    
    if (currentGroup) {
      localStorage.setItem('currentGroup', JSON.stringify(currentGroup));
      sessionStorage.setItem('currentGroup', JSON.stringify(currentGroup));
    }
    
    // Сохраняем полное состояние сессии при значимых изменениях
    if (userIdRef.current && !isColdStart) {
      const sessionState = {
        userId: userIdRef.current,
        nickname,
        selectedCity,
        selectedGender,
        clothingColor,
        wagonNumber,
        currentSelectedStation,
        currentScreen,
        timestamp: Date.now()
      };
      
      saveSessionState(sessionState);
    }
  }, [
    selectedCity, selectedGender, selectedPosition, selectedMood,
    currentSelectedStation, selectedMinutes, nickname, clothingColor,
    wagonNumber, currentScreen, currentGroup
  ]);

  // Автоматическое обновление статуса при изменении позиции или настроения
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
      
      if (nicknameInputRef.current) {
        nicknameInputRef.current.style.border = '2px solid #ff4444';
        nicknameInputRef.current.style.backgroundColor = '#fff5f5';
        nicknameInputRef.current.style.boxShadow = '0 0 0 1px #ff4444';
        nicknameInputRef.current.focus();
      }
      
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Пожалуйста, введите ваш никнейм'
      });
      
      return false;
    }
    
    setNicknameError(false);
    if (nicknameInputRef.current) {
      nicknameInputRef.current.style.border = '';
      nicknameInputRef.current.style.backgroundColor = '';
      nicknameInputRef.current.style.boxShadow = '';
    }
    
    return true;
  };

  // Валидация цвета одежды
  const validateClothingColor = () => {
    const trimmedColor = clothingColor.trim();
    if (!trimmedColor) {
      setClothingColorError(true);
      
      if (clothingColorInputRef.current) {
        clothingColorInputRef.current.style.border = '2px solid #ff4444';
        clothingColorInputRef.current.style.backgroundColor = '#fff5f5';
        clothingColorInputRef.current.style.boxShadow = '0 0 0 1px #ff4444';
        clothingColorInputRef.current.focus();
      }
      
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Пожалуйста, укажите цвет верхней одежды или стиль'
      });
      
      return false;
    }
    
    setClothingColorError(false);
    if (clothingColorInputRef.current) {
      clothingColorInputRef.current.style.border = '';
      clothingColorInputRef.current.style.backgroundColor = '';
      clothingColorInputRef.current.style.boxShadow = '';
    }
    
    return true;
  };

  // Валидация выбора станции
  const validateStation = () => {
    if (!currentSelectedStation) {
      setStationError(true);
      
      if (metroMapRef.current) {
        metroMapRef.current.style.border = '2px solid #ff4444';
        metroMapRef.current.style.boxShadow = '0 0 10px rgba(255, 68, 68, 0.3)';
      }
      
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Пожалуйста, выберите станцию на карте'
      });
      
      return false;
    }
    
    setStationError(false);
    if (metroMapRef.current) {
      metroMapRef.current.style.border = '';
      metroMapRef.current.style.boxShadow = '';
    }
    
    return true;
  };

  // Сброс ошибки при изменении никнейма
  const handleNicknameChange = (e) => {
    setNickname(e.target.value);
    if (nicknameError) {
      setNicknameError(false);
      if (nicknameInputRef.current) {
        nicknameInputRef.current.style.border = '';
        nicknameInputRef.current.style.backgroundColor = '';
        nicknameInputRef.current.style.boxShadow = '';
      }
    }
  };

  // Сброс ошибки при изменении цвета одежды
  const handleClothingColorChange = (e) => {
    setClothingColor(e.target.value);
    if (clothingColorError) {
      setClothingColorError(false);
      if (clothingColorInputRef.current) {
        clothingColorInputRef.current.style.border = '';
        clothingColorInputRef.current.style.backgroundColor = '';
        clothingColorInputRef.current.style.boxShadow = '';
      }
    }
  };

  // Сброс ошибки при выборе станции
  const handleStationSelect = (stationName) => {
    setCurrentSelectedStation(stationName);
    if (stationError) {
      setStationError(false);
      if (metroMapRef.current) {
        metroMapRef.current.style.border = '';
        metroMapRef.current.style.boxShadow = '';
      }
    }
  };

  // Вход в комнату ожидания с валидацией
  const handleEnterWaitingRoom = async () => {
    console.log('🚪 === НАЧАЛО handleEnterWaitingRoom ===');
    
    // Валидация никнейма
    if (!validateNickname()) {
      return;
    }
    
    setIsLoading(true);

    try {
      const users = await api.getUsers();
      const trimmedNickname = nickname.trim();
      
      // Проверяем, нет ли активной сессии с этого устройства
      const existingDeviceSession = users.find(user => 
        user.device_id === deviceId && 
        user.online === true
      );
      
      // Также проверяем, нет ли активной сессии с таким же никнеймом
      const existingNicknameSession = users.find(user => 
        user.name === trimmedNickname && 
        user.online === true &&
        user.id !== userIdRef.current
      );
      
      let createdUser;
      
      if (existingDeviceSession) {
        // Используем существующую сессию с этого устройства
        console.log('🔄 Используем существующую сессию с устройства:', existingDeviceSession.id);
        
        // Если есть другая сессия с таким же никнеймом, деактивируем её
        if (existingNicknameSession && existingNicknameSession.id !== existingDeviceSession.id) {
          console.log('⚠️ Найдена дублирующая сессия с таким же никнеймом, деактивируем');
          await api.updateUser(existingNicknameSession.id, {
            online: false,
            is_connected: false,
            is_waiting: false,
            status: 'Сессия заменена'
          });
        }
        
        // Обновляем существующую сессию
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
        console.log('🆕 Создаем новую сессию');
        
        // Деактивируем все сессии с этого устройства перед созданием новой
        await deactivateAllDeviceSessions(deviceId);
        
        // Если есть активная сессия с таким же никнеймом, деактивируем её
        if (existingNicknameSession) {
          console.log('⚠️ Найдена дублирующая сессия с таким же никнеймом, деактивируем');
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
        
        if (createdUser) {
          userIdRef.current = createdUser.id;
          sessionIdRef.current = newSessionId;
          console.log('✅ Создана новая сессия:', createdUser.id);
        }
      }
      
      if (createdUser) {
        // Сохраняем состояние сессии
        saveSessionState({
          userId: userIdRef.current,
          nickname: trimmedNickname,
          selectedCity,
          selectedGender,
          clothingColor,
          wagonNumber,
          currentSelectedStation,
          currentScreen: 'waiting',
          timestamp: Date.now()
        });
        
        setTimeout(() => {
          setCurrentScreen('waiting');
        }, 100);

        await loadStationsMap();
        await loadRequests();
        
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
    }
  };

  // Подтверждение выбора станции с валидацией
  const handleConfirmStation = async () => {
    console.log('📍 === НАЧАЛО handleConfirmStation ===');
    
    // Проверка цвета одежды
    if (!validateClothingColor()) {
      return;
    }
    
    // Проверка никнейма
    if (!nickname || nickname.trim() === '') {
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Пожалуйста, введите ваш никнейм'
      });
      return;
    }
    
    // Проверка выбора станции
    if (!validateStation()) {
      return;
    }

    if (!userIdRef.current) {
      console.error('❌ Нет userId, нельзя присоединиться к станции');
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Ошибка: сначала создайте профиль'
      });
      return;
    }

    setIsLoading(true);
    try {
      // Обновляем пользователя
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

      // Получаем актуальные данные о группе
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
      
      // Сохраняем состояние сессии
      saveSessionState({
        userId: userIdRef.current,
        nickname: nickname.trim(),
        selectedCity,
        selectedGender,
        clothingColor: clothingColor.trim(),
        wagonNumber,
        currentSelectedStation,
        currentScreen: 'joined',
        timestamp: Date.now()
      });
      
      // Показываем успешное уведомление
      bridge.send("VKWebAppShowSnackbar", {
        text: `✅ Вы присоединились к станции ${currentSelectedStation}`
      });
      
      // Загружаем участников группы
      setTimeout(() => {
        loadGroupMembers(currentSelectedStation);
        loadRequests(true);
      }, 100);
      
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
        console.log('✅ Пользователь вышел из группы');
        
        // Обновляем сохраненное состояние
        saveSessionState({
          userId: userIdRef.current,
          nickname,
          selectedCity,
          selectedGender,
          clothingColor,
          wagonNumber,
          currentSelectedStation: null,
          currentScreen: 'waiting',
          timestamp: Date.now()
        });
      } catch (error) {
        console.error('Ошибка при обновлении пользователя:', error);
      }
    }
    
    setCurrentGroup(null);
    setCurrentScreen('waiting');
    setSelectedPosition('');
    setSelectedMood('');
    
    // Показываем уведомление
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
    
    // Обновляем время активности
    userActivityRef.current = Date.now();
    setLastActivityTime(Date.now());
    
    if (previousPosition !== position) {
      updateUserState();
    }
  };

  const handleMoodSelect = (mood) => {
    const previousMood = selectedMood;
    setSelectedMood(mood);
    
    // Обновляем время активности
    userActivityRef.current = Date.now();
    setLastActivityTime(Date.now());
    
    if (previousMood !== mood) {
      updateUserState();
    }
  };

  const handleTimerSelect = (minutes) => {
    setSelectedMinutes(minutes);
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
      
      // Обновляем локальное состояние группы
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
      
      await loadGroupMembers();
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
      
      if (currentScreen === 'joined') {
        await loadGroupMembers();
      }
      
      return true;
    } catch (error) {
      console.error('Ошибка пинга активности:', error);
      return false;
    }
  };

  // Упрощенный обработчик закрытия страницы
  useEffect(() => {
    const handleBeforeUnload = async (event) => {
      console.log('⚠️ Страница закрывается или перезагружается');
      
      // Сохраняем текущее состояние
      if (userIdRef.current && isAppActiveRef.current) {
        const sessionState = {
          userId: userIdRef.current,
          nickname,
          selectedCity,
          selectedGender,
          clothingColor,
          wagonNumber,
          currentSelectedStation,
          currentScreen,
          timestamp: Date.now()
        };
        
        saveSessionState(sessionState);
        
        // НЕ устанавливаем пользователя в оффлайн при закрытии страницы
        // чтобы сохранить сессию для восстановления
        console.log('📱 Страница закрывается, сохраняем сессию для восстановления');
      }
    };

    // Для современных браузеров
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentScreen, currentGroup, deviceId, nickname, selectedCity, selectedGender, clothingColor, wagonNumber, currentSelectedStation]);

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

  // Рендер карты станций
  const renderStationsMap = () => {
    const { stationStats } = stationsData;
    
    if (!stationStats || stationStats.length === 0) {
      return (
        <div className="loading" style={{ textAlign: 'center', padding: '20px' }}>
          <div>Загрузка карты станций...</div>
          <small style={{ color: '#666' }}>Пока нет данных о станциях</small>
        </div>
      );
    }
    
    // Получаем список станций для выбранного города
    const cityStations = helpers.stations[selectedCity] || [];
    
    // Создаем карту для быстрого поиска
    const stationsMap = {};
    stationStats.forEach(station => {
      stationsMap[station.station] = station;
    });
    
    console.log('🗺️ Рендерим станции:', {
      totalStations: cityStations.length,
      stationsWithData: Object.keys(stationsMap).length
    });
    
    return cityStations.map(stationName => {
      const stationData = stationsMap[stationName];
      
      // Получаем данные для станции
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
  };

  // Рендер участников группы
  const renderGroupMembers = () => {
    if (groupMembers.length === 0) {
      return <div className="no-requests">Нет участников на этой станции</div>;
    }
    
    return groupMembers.map(user => {
      const isCurrentUser = userIdRef.current && user.id === userIdRef.current;
      
      let stateDetails = '';
      if (user.position || user.mood) {
        if (user.position) stateDetails += `<span class="state-highlight">${user.position}</span>`;
        if (user.mood) {
          if (user.position) stateDetails += ' • ';
          stateDetails += `<span class="state-highlight">${user.mood}</span>`;
        }
      }
      
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
              <div dangerouslySetInnerHTML={{ __html: stateDetails }} />
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
  };

  // Отображение информации о сессии
  const renderSessionInfo = () => {
    if (process.env.NODE_ENV === 'development') {
      const now = Date.now();
      const timeSinceLastActivity = now - userActivityRef.current;
      const minutesLeft = Math.max(0, Math.floor((INACTIVITY_TIMEOUT - timeSinceLastActivity) / 60000));
      
      return (
        <div className="session-info" style={{
          fontSize: '10px',
          color: '#666',
          padding: '5px',
          backgroundColor: '#f5f5f5',
          marginBottom: '10px',
          borderRadius: '5px',
          textAlign: 'center'
        }}>
          📱 Device: {deviceId?.substring(0, 10)}... | 
          👤 User ID: {userIdRef.current?.substring(0, 10)}... | 
          🖥️ Screen: {currentScreen} |
          🕒 До автоотключения: {minutesLeft} мин |
          📊 Stats: {stationsData.totalStats?.total_connected || 0}✅ {stationsData.totalStats?.total_waiting || 0}⏳
        </div>
      );
    }
    return null;
  };

  return (
    <div className="app-container">
      {renderSessionInfo()}
      
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
                  style={{
                    border: nicknameError ? '2px solid #ff4444' : '',
                    backgroundColor: nicknameError ? '#fff5f5' : '',
                    boxShadow: nicknameError ? '0 0 0 1px #ff4444' : ''
                  }}
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
              
              {nicknameError && (
                <div style={{
                  marginTop: '10px',
                  padding: '10px',
                  backgroundColor: '#fff5f5',
                  border: '1px solid #ff4444',
                  borderRadius: '5px',
                  color: '#ff4444',
                  fontSize: '12px',
                  textAlign: 'center'
                }}>
                  ⚠️ Пожалуйста, укажите ваш никнейм для продолжения
                </div>
              )}
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
                  style={{
                    border: stationError ? '2px solid #ff4444' : '',
                    boxShadow: stationError ? '0 0 10px rgba(255, 68, 68, 0.3)' : ''
                  }}
                >
                  {renderStationsMap()}
                </div>
                
                {stationError && (
                  <div style={{
                    marginTop: '10px',
                    padding: '8px',
                    backgroundColor: '#fff5f5',
                    border: '1px solid #ff4444',
                    borderRadius: '5px',
                    color: '#ff4444',
                    fontSize: '12px',
                    textAlign: 'center'
                  }}>
                    ⚠️ Пожалуйста, выберите станцию на карте выше
                  </div>
                )}
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
                    style={{
                      border: clothingColorError ? '2px solid #ff4444' : '',
                      backgroundColor: clothingColorError ? '#fff5f5' : '',
                      boxShadow: clothingColorError ? '0 0 0 1px #ff4444' : ''
                    }}
                    required 
                  />
                  <small className="field-hint" style={{ color: clothingColorError ? '#ff4444' : '' }}>
                    {clothingColorError ? '❌ Это поле обязательно для заполнения' : 'Это поле обязательно для заполнения'}
                  </small>
                </div>
                
                {(clothingColorError || stationError) && (
                  <div style={{
                    marginTop: '15px',
                    padding: '10px',
                    backgroundColor: '#fff5f5',
                    border: '1px solid #ff4444',
                    borderRadius: '5px',
                    color: '#ff4444',
                    fontSize: '12px',
                    textAlign: 'center'
                  }}>
                    {clothingColorError && stationError ? (
                      '⚠️ Пожалуйста, заполните все обязательные поля и выберите станцию'
                    ) : clothingColorError ? (
                      '⚠️ Пожалуйста, укажите цвет верхней одежды или стиль'
                    ) : (
                      '⚠️ Пожалуйста, выберите станцию на карте'
                    )}
                  </div>
                )}
                           
                <button 
                  className="btn btn-success" 
                  onClick={handleConfirmStation}
                  disabled={isLoading}
                  style={{
                    backgroundColor: clothingColorError || stationError ? '#ff4444' : '',
                    borderColor: clothingColorError || stationError ? '#ff4444' : '',
                    marginTop: clothingColorError || stationError ? '15px' : '0'
                  }}
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
              
              <p>Расскажите о своем состоянии другим участников</p>
              
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
          &copy; 2025 | Гаджи Латипов | Метрос | Санкт  Петербург
        </footer>
      </div>
    </div>
  );
};