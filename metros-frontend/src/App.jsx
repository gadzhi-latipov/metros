import { useState, useEffect, useRef, useCallback } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';

// Генерация уникального ID устройства с улучшенным хранением
const generateDeviceId = () => {
  let deviceId = localStorage.getItem('deviceId');
  
  if (!deviceId) {
    deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    localStorage.setItem('deviceId', deviceId);
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
    console.log('💾 Сохранено состояние сессии:', sessionData.userId?.substring(0, 10));
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
      
      // Проверяем не старше 24 часов
      if (now - parsed.timestamp < 24 * 60 * 60 * 1000) {
        console.log('📂 Загружено сохраненное состояние сессии:', parsed.userId?.substring(0, 10));
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
        }
      }
    });
    
    // Преобразуем объект в массив
    const stationStatsArray = Object.values(stationStats);
    
    console.log('📈 Статистика рассчитана:', {
      totalStations: stationStatsArray.length,
      totalConnected: total_connected,
      totalWaiting: total_waiting
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
  const [isColdStart, setIsColdStart] = useState(true);
  const [inactivityTimer, setInactivityTimer] = useState(30 * 60 * 1000);
  const [hasDuplicates, setHasDuplicates] = useState(false);
  
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
  const isInitialMountRef = useRef(true);
  const sessionRestoreInProgressRef = useRef(false);
  const appVisibilityHandlerRef = useRef(null);
  const offlineTimeoutRef = useRef(null);
  const pingTimeoutRef = useRef(null);
  const inactivityTimeoutRef = useRef(null);
  const isOfflineRequestRef = useRef(false);
  const isAppActiveRef = useRef(true);
  const userActivityRef = useRef(Date.now());
  const lastCleanupRef = useRef(0);

  // Улучшенная проверка и очистка дублирующих сессий
  const checkAndCleanDuplicates = useCallback(async () => {
    const now = Date.now();
    
    // Защита от слишком частых проверок
    if (now - lastCleanupRef.current < 5000) {
      return;
    }
    
    lastCleanupRef.current = now;
    
    try {
      console.log('🔄 Проверяем наличие дублирующих сессий для device:', deviceId?.substring(0, 10));
      const users = await api.getUsers();
      
      if (!deviceId) {
        console.log('⚠️ Нет deviceId, пропускаем проверку дубликатов');
        return;
      }
      
      // Находим все активные сессии с этого устройства
      const deviceSessions = users.filter(user => 
        user.device_id === deviceId && 
        user.online === true
      );
      
      // Находим все активные сессии с текущим userId (если он есть)
      const userIdSessions = userIdRef.current 
        ? users.filter(user => 
            user.id === userIdRef.current && 
            user.online === true
          )
        : [];
      
      console.log('📊 Статистика сессий:', {
        deviceSessions: deviceSessions.length,
        userIdSessions: userIdSessions.length,
        currentUserId: userIdRef.current?.substring(0, 10)
      });
      
      // Если есть более одной сессии с этого устройства
      if (deviceSessions.length > 1) {
        console.warn('⚠️ Обнаружены дублирующие сессии с этого устройства:', deviceSessions.length);
        setHasDuplicates(true);
        
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
            console.log(`🧹 Деактивируем старую сессию: ${oldSession.id?.substring(0, 10)} (${oldSession.name})`);
            await api.updateUser(oldSession.id, {
              online: false,
              is_connected: false,
              is_waiting: false,
              status: 'Сессия заменена',
              last_seen: new Date().toISOString()
            });
          }
        }
        
        // Обновляем текущий userId
        if (userIdRef.current !== latestSession.id) {
          console.log(`🔄 Смена userId с ${userIdRef.current?.substring(0, 10)} на ${latestSession.id?.substring(0, 10)}`);
          userIdRef.current = latestSession.id;
          sessionIdRef.current = latestSession.session_id || generateSessionId(deviceId);
          
          // Сохраняем состояние
          saveSessionState({
            userId: userIdRef.current,
            nickname: latestSession.name,
            selectedCity: latestSession.city || selectedCity,
            selectedGender: latestSession.gender || selectedGender,
            clothingColor: latestSession.color || clothingColor,
            wagonNumber: latestSession.wagon || wagonNumber,
            currentSelectedStation: latestSession.station || currentSelectedStation,
            currentScreen: latestSession.is_connected ? 'joined' : latestSession.is_waiting ? 'waiting' : 'setup',
            timestamp: Date.now()
          });
        }
        
        console.log('✅ Дублирующие сессии очищены');
        setHasDuplicates(false);
      } else if (deviceSessions.length === 1) {
        // Только одна сессия с устройства - все хорошо
        const currentSession = deviceSessions[0];
        
        // Если userId не установлен или не совпадает, обновляем
        if (!userIdRef.current || userIdRef.current !== currentSession.id) {
          console.log(`🔄 Устанавливаем userId из устройства: ${currentSession.id?.substring(0, 10)}`);
          userIdRef.current = currentSession.id;
          sessionIdRef.current = currentSession.session_id || generateSessionId(deviceId);
          
          // Обновляем локальные данные из сессии
          if (currentSession.name) setNickname(currentSession.name);
          if (currentSession.city) setSelectedCity(currentSession.city);
          if (currentSession.gender) setSelectedGender(currentSession.gender);
          if (currentSession.color) setClothingColor(currentSession.color);
          if (currentSession.wagon) setWagonNumber(currentSession.wagon);
          if (currentSession.station) setCurrentSelectedStation(currentSession.station);
          
          // Определяем экран на основе состояния сессии
          if (currentSession.is_connected && currentSession.station) {
            setCurrentScreen('joined');
            setCurrentGroup({ station: currentSession.station, users: [] });
          } else if (currentSession.is_waiting) {
            setCurrentScreen('waiting');
          }
        }
        
        setHasDuplicates(false);
      }
      
    } catch (error) {
      console.error('❌ Ошибка при проверке дублирующих сессий:', error);
    }
  }, [deviceId, selectedCity, selectedGender, clothingColor, wagonNumber, currentSelectedStation]);

  // Основная инициализация приложения
  useEffect(() => {
    console.log('✅ React компонент App загружен');
    
    // Инициализация устройства
    const generatedDeviceId = generateDeviceId();
    setDeviceId(generatedDeviceId);
    
    console.log('📱 Идентификатор устройства:', generatedDeviceId);
    
    // Загружаем сохраненные данные из localStorage
    const savedNickname = localStorage.getItem('nickname');
    const savedClothingColor = localStorage.getItem('clothingColor');
    const savedWagonNumber = localStorage.getItem('wagonNumber');
    const savedSelectedStation = localStorage.getItem('selectedStation');
    
    if (savedNickname) setNickname(savedNickname);
    if (savedClothingColor) setClothingColor(savedClothingColor);
    if (savedWagonNumber) setWagonNumber(savedWagonNumber);
    if (savedSelectedStation) setCurrentSelectedStation(savedSelectedStation);
    
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

    // Обработчик видимости страницы
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('📱 Приложение скрыто/свернуто');
        isAppActiveRef.current = false;
        setAppState('background');
        
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
      console.log('📡 VK Bridge событие:', type);
      
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
        console.log('👤 Данные пользователя VK загружены:', user.id);
      } catch (error) {
        console.error('❌ Ошибка загрузки пользователя:', error);
      }
    }
    
    fetchUserData();
    
    // Улучшенное восстановление сессии пользователя
    const restoreSession = async () => {
      if (sessionRestoreInProgressRef.current) {
        console.log('🔄 Восстановление сессии уже выполняется, пропускаем');
        return;
      }
      
      sessionRestoreInProgressRef.current = true;
      setIsSessionRestoring(true);
      setRestoreAttempted(true);
      
      try {
        console.log('🔄 Начинаем восстановление сессии для device:', generatedDeviceId);
        
        // Сначала проверяем и чистим дубликаты
        await checkAndCleanDuplicates();
        
        // Пытаемся загрузить сохраненное состояние
        const savedState = loadSessionState();
        
        // Пытаемся найти активную сессию на сервере
        let users = [];
        try {
          users = await api.getUsers();
        } catch (error) {
          console.error('❌ Не удалось загрузить пользователей с сервера:', error);
        }
        
        // Ищем сессию по deviceId в первую очередь
        let serverSession = users.find(user => 
          user.device_id === generatedDeviceId &&
          user.online === true
        );
        
        // Если не нашли по deviceId, ищем по сохраненному userId
        if (!serverSession && savedState?.userId) {
          serverSession = users.find(user => 
            user.id === savedState.userId &&
            user.online === true
          );
        }
        
        if (serverSession) {
          console.log('✅ Активная сессия найдена на сервере, восстанавливаем:', serverSession.id?.substring(0, 10));
          userIdRef.current = serverSession.id;
          sessionIdRef.current = serverSession.session_id || generateSessionId(generatedDeviceId);
          
          // Восстанавливаем данные из серверной сессии
          if (serverSession.name) setNickname(serverSession.name);
          if (serverSession.city) setSelectedCity(serverSession.city);
          if (serverSession.gender) setSelectedGender(serverSession.gender);
          if (serverSession.color) setClothingColor(serverSession.color);
          if (serverSession.wagon) setWagonNumber(serverSession.wagon);
          if (serverSession.station) setCurrentSelectedStation(serverSession.station);
          
          // Обновляем сессию на сервере
          try {
            await api.updateUser(serverSession.id, {
              session_id: sessionIdRef.current,
              online: true,
              last_seen: new Date().toISOString(),
              device_id: generatedDeviceId
            });
          } catch (error) {
            console.error('❌ Ошибка обновления сессии на сервере:', error);
          }
          
          // Определяем экран на основе состояния сессии
          if (serverSession.is_connected && serverSession.station) {
            setCurrentScreen('joined');
            const groupData = {
              station: serverSession.station,
              users: []
            };
            setCurrentGroup(groupData);
            
            // Загружаем данные группы
            setTimeout(async () => {
              await loadGroupMembers(serverSession.station);
              await loadRequests();
            }, 300);
          } else if (serverSession.is_waiting) {
            setCurrentScreen('waiting');
            setTimeout(async () => {
              await loadStationsMap();
              await loadRequests();
            }, 300);
          } else {
            setCurrentScreen('setup');
          }
          
          console.log('🎯 Сессия восстановлена. Экран:', currentScreen);
          
        } else if (savedState?.userId) {
          console.log('🔄 Нет активной сессии на сервере, но есть сохраненное состояние');
          
          // Восстанавливаем из сохраненного состояния
          userIdRef.current = savedState.userId;
          sessionIdRef.current = generateSessionId(generatedDeviceId);
          
          if (savedState.nickname) setNickname(savedState.nickname);
          if (savedState.selectedCity) setSelectedCity(savedState.selectedCity);
          if (savedState.selectedGender) setSelectedGender(savedState.selectedGender);
          if (savedState.clothingColor) setClothingColor(savedState.clothingColor);
          if (savedState.wagonNumber) setWagonNumber(savedState.wagonNumber);
          if (savedState.currentSelectedStation) setCurrentSelectedStation(savedState.currentSelectedStation);
          
          // Восстанавливаем экран
          if (savedState.currentScreen === 'joined' && savedState.currentSelectedStation) {
            setCurrentScreen('joined');
            const groupData = {
              station: savedState.currentSelectedStation,
              users: []
            };
            setCurrentGroup(groupData);
          } else if (savedState.currentScreen === 'waiting') {
            setCurrentScreen('waiting');
          } else {
            setCurrentScreen('setup');
          }
          
          console.log('📂 Восстановлено из сохраненного состояния. Экран:', savedState.currentScreen);
          
        } else {
          console.log('🆕 Нет сохраненной сессии, начинаем с настройки');
          setCurrentScreen('setup');
        }
        
      } catch (error) {
        console.error('❌ Критическая ошибка восстановления сессии:', error);
        setCurrentScreen('setup');
      } finally {
        setIsSessionRestoring(false);
        sessionRestoreInProgressRef.current = false;
        setIsColdStart(false);
        
        // Загружаем карту станций если нужно
        if (currentScreen === 'waiting') {
          setTimeout(() => {
            loadStationsMap();
          }, 500);
        }
      }
    };
    
    // Даем время на инициализацию, затем восстанавливаем сессию
    setTimeout(() => {
      restoreSession();
    }, 1000);
    
    // Запуск глобального обновления
    const cleanupGlobalRefresh = () => {
      const interval = setInterval(async () => {
        try {
          // Периодически проверяем дубликаты
          if (Math.random() < 0.3) { // 30% шанс проверить дубликаты
            await checkAndCleanDuplicates();
          }
          
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
    
    cleanupGlobalRefresh();

    const startInactivityTimer = () => {
      const checkInactivity = () => {
        const now = Date.now();
        const timeSinceLastActivity = now - userActivityRef.current;
        
        if (timeSinceLastActivity > INACTIVITY_TIMEOUT && userIdRef.current && isAppActiveRef.current) {
          console.log('⏰ 30 минут неактивности, устанавливаем в оффлайн');
          setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
        } else {
          inactivityTimeoutRef.current = setTimeout(checkInactivity, 60000);
        }
      };
      
      inactivityTimeoutRef.current = setTimeout(checkInactivity, 60000);
    };
    
    setTimeout(startInactivityTimer, 1000);

    const handleOnline = async () => {
      console.log('🌐 Интернет восстановлен');
      setIsOnline(true);
      
      if (userIdRef.current && (currentScreen === 'joined' || currentScreen === 'waiting')) {
        try {
          // Проверяем и чистим дубликаты при восстановлении соединения
          await checkAndCleanDuplicates();
          
          await api.updateUser(userIdRef.current, {
            online: true,
            last_seen: new Date().toISOString(),
            session_id: sessionIdRef.current,
            device_id: generatedDeviceId
          });
          console.log('✅ Сессия восстановлена после потери соединения');
          
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
      
      if (userIdRef.current && !isOfflineRequestRef.current) {
        isOfflineRequestRef.current = true;
        setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
      }
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      if (globalRefreshIntervalRef.current) {
        clearInterval(globalRefreshIntervalRef.current);
      }
      
      clearTimeout(offlineTimeoutRef.current);
      clearTimeout(pingTimeoutRef.current);
      clearTimeout(inactivityTimeoutRef.current);
      
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

  // Загрузка статистики станций
  const loadStationsMap = async () => {
    try {
      console.log('🗺️ Загрузка статистики станций для города:', selectedCity);
      
      const users = await api.getUsers();
      const stats = calculateStationsStats(users, selectedCity);
      
      setStationsData(stats);
      
      const activeUsers = users.filter(user => user.online === true);
      setAllUsers(activeUsers);
      setUsersCache(activeUsers);
      setCacheTimestamp(Date.now());
      
      console.log('✅ Статистика загружена:', {
        stations: stats.stationStats.length,
        connected: stats.totalStats.total_connected,
        waiting: stats.totalStats.total_waiting
      });
      
      return stats;
    } catch (error) {
      console.error('❌ Ошибка загрузки карты станций:', error);
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
      
      const groupUsers = users.filter(user => 
        user.station === targetStation && 
        user.is_connected === true &&
        user.online === true
      );
      
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
          const users = await api.getUsers();
          const freshGroupMembers = users.filter(user => 
            user.station === currentGroup.station && 
            user.is_connected === true &&
            user.online === true
          );
          
          setGroupMembers(prevMembers => {
            const prevIds = prevMembers.map(u => u.id).sort();
            const newIds = freshGroupMembers.map(u => u.id).sort();
            
            if (JSON.stringify(prevIds) !== JSON.stringify(newIds)) {
              console.log('🔄 Обновлен состав участников группы');
              return freshGroupMembers;
            }
            
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
          
          await loadStationsMap();
          
        } catch (error) {
          console.error('Ошибка обновления данных:', error);
        }
      }
    }, 2000);
    
    return () => clearInterval(realtimePollingInterval);
  }, [currentScreen, currentGroup]);

  // Сохранение состояний в localStorage при изменениях
  useEffect(() => {
    if (!isColdStart) {
      localStorage.setItem('selectedCity', selectedCity);
      localStorage.setItem('selectedGender', selectedGender);
      localStorage.setItem('selectedPosition', selectedPosition);
      localStorage.setItem('selectedMood', selectedMood);
      localStorage.setItem('selectedStation', currentSelectedStation || '');
      localStorage.setItem('selectedTimerMinutes', selectedMinutes.toString());
      localStorage.setItem('nickname', nickname);
      localStorage.setItem('clothingColor', clothingColor);
      localStorage.setItem('wagonNumber', wagonNumber);
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
          currentScreen,
          timestamp: Date.now()
        };
        
        saveSessionState(sessionState);
      }
    }
  }, [
    selectedCity, selectedGender, selectedPosition, selectedMood,
    currentSelectedStation, selectedMinutes, nickname, clothingColor,
    wagonNumber, currentScreen, currentGroup, isColdStart
  ]);

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

  // Вход в комнату ожидания с валидацией и проверкой дубликатов
  const handleEnterWaitingRoom = async () => {
    console.log('🚪 === НАЧАЛО handleEnterWaitingRoom ===');
    
    if (!validateNickname()) {
      return;
    }
    
    setIsLoading(true);

    try {
      // Сначала проверяем и чистим существующие дубликаты
      await checkAndCleanDuplicates();
      
      const users = await api.getUsers();
      const trimmedNickname = nickname.trim();
      
      // Проверяем существующие сессии
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
        console.log('🔄 Используем существующую сессию с устройства:', existingDeviceSession.id?.substring(0, 10));
        
        // Деактивируем дублирующие сессии с таким же никнеймом
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
        
        // Деактивируем старые сессии с таким же никнеймом
        if (existingNicknameSession) {
          console.log('⚠️ Найдена старая сессия с таким же никнеймом, деактивируем');
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
          console.log('✅ Создана новая сессия:', createdUser.id?.substring(0, 10));
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
        
        setCurrentScreen('waiting');
        
        setTimeout(async () => {
          await loadStationsMap();
          await loadRequests();
        }, 100);

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
    
    if (!validateClothingColor()) {
      return;
    }
    
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
      
      bridge.send("VKWebAppShowSnackbar", {
        text: `✅ Вы присоединились к станции ${currentSelectedStation}`
      });
      
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

  // Обработчик закрытия страницы
  useEffect(() => {
    const handleBeforeUnload = async (event) => {
      console.log('⚠️ Страница закрывается или перезагружается');
      
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
        
        console.log('📱 Сохранена сессия для восстановления:', userIdRef.current?.substring(0, 10));
      }
    };

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
    
    const cityStations = helpers.stations[selectedCity] || [];
    const stationsMap = {};
    stationStats.forEach(station => {
      stationsMap[station.station] = station;
    });
    
    return cityStations.map(stationName => {
      const stationData = stationsMap[stationName];
      
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
          👤 User ID: {userIdRef.current ? userIdRef.current.substring(0, 10) + '...' : 'none'} | 
          🖥️ Screen: {currentScreen} |
          🕒 До автоотключения: {minutesLeft} мин |
          📊 Stats: {stationsData.totalStats?.total_connected || 0}✅ {stationsData.totalStats?.total_waiting || 0}⏳
          {hasDuplicates && (
            <span style={{color: '#ff4444', marginLeft: '10px'}}>
              ⚠️ Обнаружены дубликаты
            </span>
          )}
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
          &copy; 2026 | Гаджи Латипов | Метрос | Санкт  Петербург
        </footer>
      </div>
    </div>
  );
};