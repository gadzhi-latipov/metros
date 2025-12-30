import { useState, useEffect, useRef } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';

// Генерация уникального ID устройства с сохранением в localStorage
const generateDeviceId = () => {
  // Пробуем получить сохраненный deviceId
  const savedDeviceId = localStorage.getItem('metro_device_id');
  if (savedDeviceId && savedDeviceId.startsWith('device_')) {
    return savedDeviceId;
  }
  
  // Генерируем новый
  const newDeviceId = 'device_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  localStorage.setItem('metro_device_id', newDeviceId);
  return newDeviceId;
};

// Генерация сессии
const generateSessionId = (deviceId) => {
  return `session_${deviceId}_${Date.now()}`;
};

// Флаг восстановления сессии (предотвращает множественные вызовы)
let isRestoringSession = false;
let sessionRestorePromise = null;

// Улучшенная функция для сохранения данных в VK Storage
const saveToVKStorage = async (key, value) => {
  try {
    if (!key || typeof key !== 'string') {
      return false;
    }
    
    // Ограничиваем длину значения
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const limitedValue = stringValue.length > 4000 ? stringValue.substring(0, 4000) : stringValue;
    
    // Используем Promise с таймаутом
    const savePromise = bridge.send('VKWebAppStorageSet', {
      key: key,
      value: limitedValue
    });
    
    // Добавляем таймаут
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('VK Storage timeout')), 3000)
    );
    
    const result = await Promise.race([savePromise, timeoutPromise]);
    
    if (result && result.result) {
      console.log('💾 Данные сохранены в VK Storage:', key);
      return true;
    }
    return false;
  } catch (error) {
    console.warn('⚠️ Ошибка сохранения в VK Storage:', error.message);
    // Пробуем сохранить в localStorage как запасной вариант
    try {
      localStorage.setItem(`metro_${key}`, JSON.stringify(value));
      return true;
    } catch (localError) {
      console.error('❌ Ошибка сохранения в localStorage:', localError);
      return false;
    }
  }
};

// Улучшенная функция для получения данных из VK Storage
const getFromVKStorage = async (key) => {
  try {
    // Сначала проверяем sessionStorage для быстрого доступа
    const sessionData = sessionStorage.getItem(`metro_${key}`);
    if (sessionData) {
      try {
        console.log('📂 Данные загружены из sessionStorage:', key);
        return JSON.parse(sessionData);
      } catch (e) {
        console.warn('⚠️ Ошибка парсинга данных из sessionStorage:', key);
      }
    }
    
    // Пробуем VK Storage с таймаутом
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('VK Storage timeout')), 3000)
      );
      
      const storagePromise = bridge.send('VKWebAppStorageGet', {
        keys: [key]
      });
      
      const result = await Promise.race([storagePromise, timeoutPromise]);
      
      if (result.keys && result.keys.length > 0) {
        const item = result.keys.find(k => k.key === key);
        if (item && item.value) {
          console.log('📂 Данные загружены из VK Storage:', key);
          try {
            const parsedData = JSON.parse(item.value);
            // Сохраняем в sessionStorage для быстрого доступа
            sessionStorage.setItem(`metro_${key}`, item.value);
            return parsedData;
          } catch (e) {
            return item.value;
          }
        }
      }
    } catch (storageError) {
      console.warn('⚠️ Ошибка загрузки из VK Storage:', storageError.message);
    }
    
    // Пробуем localStorage как запасной вариант
    const localData = localStorage.getItem(`metro_${key}`);
    if (localData) {
      try {
        console.log('📂 Данные загружены из localStorage:', key);
        return JSON.parse(localData);
      } catch (e) {
        return localData;
      }
    }
    
    return null;
  } catch (error) {
    console.warn('⚠️ Общая ошибка загрузки из хранилищ:', error.message);
    return null;
  }
};

// Улучшенная функция для сохранения состояния сессии
const saveSessionState = async (state) => {
  try {
    const sessionData = {
      ...state,
      timestamp: Date.now(),
      version: '1.2'
    };
    
    // Сохраняем в sessionStorage для мгновенного доступа
    sessionStorage.setItem('metro_session_state', JSON.stringify(sessionData));
    
    // Сохраняем в VK Storage в фоне (не блокируем основной поток)
    setTimeout(async () => {
      try {
        await saveToVKStorage('metro_session_state', sessionData);
      } catch (error) {
        console.warn('⚠️ Фоновая ошибка сохранения в VK Storage:', error.message);
      }
    }, 100);
    
    console.log('💾 Состояние сессии сохранено локально');
  } catch (error) {
    console.error('❌ Ошибка сохранения состояния сессии:', error);
  }
};

// Улучшенная функция для загрузки состояния сессии
const loadSessionState = async () => {
  try {
    // 1. Сначала sessionStorage (самый быстрый)
    let sessionData = sessionStorage.getItem('metro_session_state');
    let fromStorage = 'sessionStorage';
    
    // 2. Если нет в sessionStorage, пробуем VK Storage
    if (!sessionData) {
      sessionData = await getFromVKStorage('metro_session_state');
      fromStorage = 'VK Storage';
      
      if (sessionData) {
        if (typeof sessionData === 'string') {
          try {
            sessionData = JSON.parse(sessionData);
          } catch (e) {
            console.warn('⚠️ Ошибка парсинга данных из VK Storage');
            return null;
          }
        }
        // Сохраняем в sessionStorage для быстрого доступа
        sessionStorage.setItem('metro_session_state', JSON.stringify(sessionData));
      }
    } else {
      try {
        sessionData = JSON.parse(sessionData);
      } catch (e) {
        console.warn('⚠️ Ошибка парсинга данных из sessionStorage');
        return null;
      }
    }
    
    if (sessionData) {
      const now = Date.now();
      
      // Проверяем актуальность (сессия действительна 30 минут)
      const sessionAge = now - sessionData.timestamp;
      if (sessionAge < 30 * 60 * 1000) {
        console.log(`📂 Загружено состояние сессии из ${fromStorage}`, {
          userId: sessionData.userId?.substring(0, 10) + '...',
          screen: sessionData.currentScreen,
          age: Math.round(sessionAge / 1000) + 's назад'
        });
        return sessionData;
      } else {
        console.log('🕒 Состояние сессии устарело:', Math.round(sessionAge / 1000) + 's');
        await clearSessionState();
      }
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки состояния сессии:', error);
  }
  
  return null;
};

// Функция для очистки состояния сессии
const clearSessionState = async () => {
  try {
    // Удаляем из всех хранилищ
    sessionStorage.removeItem('metro_session_state');
    sessionStorage.removeItem('metro_session_restored');
    
    // Асинхронно удаляем из VK Storage
    setTimeout(async () => {
      try {
        await bridge.send('VKWebAppStorageSet', {
          key: 'metro_session_state',
          value: ''
        });
      } catch (error) {
        console.warn('⚠️ Ошибка очистки VK Storage:', error.message);
      }
    }, 0);
    
    console.log('🧹 Состояние сессии очищено');
  } catch (error) {
    console.error('❌ Ошибка очистки состояния сессии:', error);
  }
};

// Улучшенная функция для установки пользователя в оффлайн
const setUserOffline = async (userId, sessionId, deviceId) => {
  if (!userId) return;
  
  // Отмечаем локально, что пользователь оффлайн
  const offlineTimestamp = new Date().toISOString();
  localStorage.setItem(`metro_user_${userId}_last_seen`, offlineTimestamp);
  
  // Асинхронно обновляем на сервере
  setTimeout(async () => {
    try {
      console.log('👋 Устанавливаем пользователя в оффлайн:', userId);
      await api.updateUser(userId, { 
        online: false,
        last_seen: offlineTimestamp,
        session_id: sessionId,
        device_id: deviceId
      });
      console.log('✅ Пользователь успешно установлен в оффлайн');
    } catch (error) {
      console.warn('⚠️ Ошибка установки пользователя в оффлайн:', error.message);
    }
  }, 100);
};

// Функция для вычисления статистики станций
const calculateStationsStats = (users, city) => {
  try {
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

// Оптимизированный дебаунс
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

// Флаг для отслеживания завершения восстановления
const SESSION_RESTORE_TIMEOUT = 10000; // 10 секунд максимум

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
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [deviceId, setDeviceId] = useState('');
  const [isSessionRestoring, setIsSessionRestoring] = useState(false);
  const [nicknameError, setNicknameError] = useState(false);
  const [clothingColorError, setClothingColorError] = useState(false);
  const [stationError, setStationError] = useState(false);
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  const [isColdStart, setIsColdStart] = useState(true);
  const [lastVisibilityChange, setLastVisibilityChange] = useState(0);
  
  const CACHE_DURATION = 10000;
  const PING_INTERVAL = 15000;
  const VISIBILITY_DEBOUNCE = 500;

  const userIdRef = useRef(null);
  const globalRefreshIntervalRef = useRef(null);
  const sessionIdRef = useRef('');
  const vkUserIdRef = useRef(null);
  const nicknameInputRef = useRef(null);
  const clothingColorInputRef = useRef(null);
  const metroMapRef = useRef(null);
  const appVisibilityHandlerRef = useRef(null);
  const previousSessionDataRef = useRef(null);
  const isTabActiveRef = useRef(true);
  const sessionRestoreTimeoutRef = useRef(null);
  const sessionRestoreAttemptsRef = useRef(0);
  const MAX_SESSION_RESTORE_ATTEMPTS = 2;

  // Улучшенная инициализация приложения
  useEffect(() => {
    console.log('✅ React компонент App загружен');
    
    // Проверяем, не восстанавливается ли уже сессия
    if (sessionStorage.getItem('metro_session_restoring') === 'true') {
      console.log('🔄 Обнаружено предыдущее восстановление сессии, пропускаем');
      sessionStorage.removeItem('metro_session_restoring');
      setIsColdStart(false);
      return;
    }
    
    // Инициализация устройства
    const generatedDeviceId = generateDeviceId();
    setDeviceId(generatedDeviceId);
    console.log('📱 Идентификатор устройства:', generatedDeviceId);
    
    // Быстрая инициализация без блокировки
    const initApp = async () => {
      // 1. Быстрая инициализация VK Bridge
      try {
        const initPromise = bridge.send("VKWebAppInit");
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('VK Bridge timeout')), 5000)
        );
        
        const data = await Promise.race([initPromise, timeoutPromise]);
        if (data.result) {
          console.log('✅ VK Bridge инициализирован');
        }
      } catch (error) {
        console.warn('⚠️ Ошибка инициализации VK Bridge:', error.message);
      }
      
      // 2. Загрузка данных пользователя VK (не блокирующая)
      setTimeout(async () => {
        try {
          const user = await bridge.send('VKWebAppGetUserInfo');
          setUser(user);
          vkUserIdRef.current = user.id;
          console.log('👤 Данные пользователя VK загружены:', user.id);
        } catch (error) {
          console.warn('⚠️ Ошибка загрузки пользователя VK:', error.message);
          vkUserIdRef.current = 'anonymous_' + Date.now();
        }
      }, 100);
      
      // 3. Восстановление сессии (с защитой от повторных вызовов)
      setTimeout(() => {
        restoreSession(generatedDeviceId);
      }, 300);
    };
    
    initApp();
    
    // Улучшенная обработка видимости страницы
    const handleVisibilityChange = debounce((event) => {
      const now = Date.now();
      if (now - lastVisibilityChange < VISIBILITY_DEBOUNCE) {
        return;
      }
      
      setLastVisibilityChange(now);
      
      if (document.hidden || event.type === 'blur') {
        console.log('📱 Приложение скрыто/свернуто');
        isTabActiveRef.current = false;
        setAppState('background');
        
        // Сохраняем состояние перед уходом
        saveSessionStateOnUnload();
        
        // Устанавливаем пользователя в оффлайн
        if (userIdRef.current) {
          setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
        }
      } else {
        console.log('📱 Приложение активно');
        isTabActiveRef.current = true;
        setAppState('active');
        
        // Восстанавливаем сессию если нужно
        if (userIdRef.current) {
          improvedPingActivity();
        }
      }
    }, VISIBILITY_DEBOUNCE);
    
    // Улучшенная обработка событий VK Bridge
    const bridgeEventHandler = (event) => {
      if (!event.detail) return;
      
      const { type, data } = event.detail;
      
      switch (type) {
        case 'VKWebAppUpdateConfig':
          try {
            const schemeAttribute = document.createAttribute('scheme');
            schemeAttribute.value = data.scheme ? data.scheme : 'client_light';
            document.body.attributes.setNamedItem(schemeAttribute);
          } catch (e) {
            console.warn('⚠️ Ошибка обновления схемы:', e.message);
          }
          break;
          
        case 'VKWebAppViewHide':
          console.log('📱 VKWebAppViewHide - приложение скрыто');
          handleVisibilityChange({ type: 'blur' });
          break;
          
        case 'VKWebAppViewRestore':
          console.log('📱 VKWebAppViewRestore - приложение восстановлено');
          handleVisibilityChange({ type: 'focus' });
          break;
          
        default:
          break;
      }
    };
    
    // Установка обработчиков
    appVisibilityHandlerRef.current = handleVisibilityChange;
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    bridge.subscribe(bridgeEventHandler);
    
    // Запуск глобального обновления (только когда вкладка активна)
    const cleanupGlobalRefresh = startGlobalRefresh();
    
    // Обработка сетевого статуса
    const handleNetworkChange = () => {
      setIsOnline(navigator.onLine);
      if (navigator.onLine && userIdRef.current) {
        improvedPingActivity();
      }
    };
    
    window.addEventListener('online', handleNetworkChange);
    window.addEventListener('offline', handleNetworkChange);
    
    // Очистка при размонтировании
    return () => {
      cleanupGlobalRefresh();
      
      if (globalRefreshIntervalRef.current) {
        clearInterval(globalRefreshIntervalRef.current);
      }
      
      // Очищаем таймаут восстановления
      if (sessionRestoreTimeoutRef.current) {
        clearTimeout(sessionRestoreTimeoutRef.current);
        sessionRestoreTimeoutRef.current = null;
      }
      
      // Удаляем обработчики событий
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      window.removeEventListener('online', handleNetworkChange);
      window.removeEventListener('offline', handleNetworkChange);
      bridge.unsubscribe(bridgeEventHandler);
      
      // Сохраняем состояние перед уходом
      saveSessionStateOnUnload();
      
      // Устанавливаем пользователя в оффлайн
      if (userIdRef.current) {
        setUserOffline(userIdRef.current, sessionIdRef.current, generatedDeviceId);
      }
      
      // Сбрасываем флаг восстановления
      sessionStorage.removeItem('metro_session_restoring');
      isRestoringSession = false;
      sessionRestorePromise = null;
    };
  }, []);

  // Функция сохранения состояния при уходе
  const saveSessionStateOnUnload = () => {
    if (!userIdRef.current) return;
    
    const sessionState = {
      userId: userIdRef.current,
      nickname,
      selectedCity,
      selectedGender,
      clothingColor,
      wagonNumber,
      currentSelectedStation,
      currentScreen,
      timestamp: Date.now(),
      version: '1.2'
    };
    
    // Быстрое сохранение в sessionStorage
    try {
      sessionStorage.setItem('metro_session_state', JSON.stringify(sessionState));
      sessionStorage.setItem('metro_session_restored', 'true');
    } catch (e) {
      console.warn('⚠️ Ошибка сохранения в sessionStorage:', e.message);
    }
  };

  // Улучшенное восстановление сессии с защитой от бесконечного цикла
  const restoreSession = async (generatedDeviceId) => {
    // Проверяем, не восстанавливается ли уже сессия
    if (isRestoringSession) {
      console.log('🔄 Восстановление сессии уже выполняется, пропускаем');
      if (sessionRestorePromise) {
        return sessionRestorePromise;
      }
    }
    
    // Проверяем количество попыток
    if (sessionRestoreAttemptsRef.current >= MAX_SESSION_RESTORE_ATTEMPTS) {
      console.log('🛑 Достигнуто максимальное количество попыток восстановления');
      setCurrentScreen('setup');
      setIsColdStart(false);
      return;
    }
    
    // Устанавливаем флаг восстановления
    isRestoringSession = true;
    sessionRestoreAttemptsRef.current++;
    setIsSessionRestoring(true);
    
    // Устанавливаем таймаут для восстановления
    sessionRestoreTimeoutRef.current = setTimeout(() => {
      console.log('⏰ Таймаут восстановления сессии');
      isRestoringSession = false;
      setIsSessionRestoring(false);
      setCurrentScreen('setup');
      setIsColdStart(false);
      
      // Очищаем флаг в sessionStorage
      sessionStorage.removeItem('metro_session_restoring');
    }, SESSION_RESTORE_TIMEOUT);
    
    // Устанавливаем флаг в sessionStorage
    sessionStorage.setItem('metro_session_restoring', 'true');
    
    try {
      console.log(`🔄 Начинаем восстановление сессии (попытка ${sessionRestoreAttemptsRef.current})...`);
      
      // 1. Проверяем, не была ли уже восстановлена сессия в этой вкладке
      if (sessionStorage.getItem('metro_session_restored') === 'true') {
        console.log('✅ Сессия уже была восстановлена в этой вкладке');
        const savedState = sessionStorage.getItem('metro_session_state');
        if (savedState) {
          try {
            const state = JSON.parse(savedState);
            await quickRestoreFromState(state, generatedDeviceId);
            return;
          } catch (e) {
            console.warn('⚠️ Ошибка быстрого восстановления:', e.message);
          }
        }
      }
      
      // 2. Полная загрузка состояния
      const savedState = await loadSessionState();
      
      if (savedState) {
        console.log('📂 Используем сохраненное состояние сессии');
        previousSessionDataRef.current = savedState;
        
        // Полное восстановление из сохраненного состояния
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
      // Очищаем таймаут
      if (sessionRestoreTimeoutRef.current) {
        clearTimeout(sessionRestoreTimeoutRef.current);
        sessionRestoreTimeoutRef.current = null;
      }
      
      // Сбрасываем флаги
      isRestoringSession = false;
      setIsSessionRestoring(false);
      setIsColdStart(false);
      
      // Очищаем флаг в sessionStorage
      sessionStorage.removeItem('metro_session_restoring');
      sessionStorage.setItem('metro_session_restored', 'true');
      
      console.log('✅ Восстановление сессии завершено');
    }
  };

  // Быстрое восстановление из состояния в sessionStorage
  const quickRestoreFromState = async (state, deviceId) => {
    try {
      console.log('⚡ Быстрое восстановление из sessionStorage');
      
      // Восстанавливаем локальное состояние
      if (state.nickname) setNickname(state.nickname);
      if (state.selectedCity) setSelectedCity(state.selectedCity);
      if (state.selectedGender) setSelectedGender(state.selectedGender);
      if (state.clothingColor) setClothingColor(state.clothingColor);
      if (state.wagonNumber) setWagonNumber(state.wagonNumber);
      if (state.currentSelectedStation) setCurrentSelectedStation(state.currentSelectedStation);
      
      // Устанавливаем userId если есть
      if (state.userId) {
        userIdRef.current = state.userId;
      }
      
      // Устанавливаем экран
      if (state.currentScreen) {
        setCurrentScreen(state.currentScreen);
      }
      
      // Если был в комнате станции, создаем группу
      if (state.currentScreen === 'joined' && state.currentSelectedStation) {
        const groupData = {
          station: state.currentSelectedStation,
          users: []
        };
        setCurrentGroup(groupData);
        
        // Асинхронно загружаем участников
        setTimeout(() => {
          loadGroupMembers(state.currentSelectedStation);
        }, 500);
      }
      
      // Асинхронно проверяем сессию на сервере
      setTimeout(async () => {
        try {
          const users = await api.getUsers();
          const serverSession = users.find(user => 
            user.id === state.userId &&
            user.device_id === deviceId
          );
          
          if (serverSession) {
            // Обновляем сессию
            const newSessionId = generateSessionId(deviceId);
            sessionIdRef.current = newSessionId;
            
            await api.updateUser(serverSession.id, {
              session_id: newSessionId,
              online: true,
              last_seen: new Date().toISOString(),
              device_id: deviceId
            });
            
            console.log('✅ Сессия подтверждена на сервере');
          }
        } catch (error) {
          console.warn('⚠️ Ошибка проверки сессии на сервере:', error.message);
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Ошибка быстрого восстановления:', error);
    }
  };

  // Полное восстановление из сохраненного состояния
  const restoreFromSavedState = async (savedState, deviceId) => {
    try {
      console.log('🔄 Восстанавливаем из сохраненного состояния:', {
        userId: savedState.userId?.substring(0, 10) + '...',
        screen: savedState.currentScreen
      });
      
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
      
      // Показываем экран загрузки
      if (savedState.currentScreen) {
        setCurrentScreen(savedState.currentScreen);
      }
      
      // Быстрая проверка сессии на сервере
      setTimeout(async () => {
        try {
          const users = await api.getUsers();
          const serverSession = users.find(user => 
            user.id === savedState.userId &&
            user.device_id === deviceId &&
            user.online === true
          );
          
          if (serverSession) {
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
              }, 300);
              
            } else if (serverSession.is_waiting) {
              // Восстанавливаем комнату ожидания
              setCurrentScreen('waiting');
            }
          } else {
            // Сессии нет на сервере или она неактивна
            console.log('❌ Сессия не найдена на сервере, начинаем заново');
            setCurrentScreen('setup');
            await clearSessionState();
          }
        } catch (error) {
          console.warn('⚠️ Ошибка проверки сессии на сервере:', error.message);
          // Оставляем пользователя в текущем состоянии
        }
      }, 500);
      
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
      
      // Ищем самую свежую сессию для этого устройства
      const deviceSessions = users.filter(user => 
        user.device_id === deviceId && user.online === true
      );
      
      console.log(`📊 Найдено активных сессий для устройства ${deviceId}:`, deviceSessions.length);
      
      if (deviceSessions.length === 0) {
        console.log('🆕 Нет активных сессий для этого устройства, начинаем с настройки');
        setCurrentScreen('setup');
        return;
      }
      
      // Выбираем самую свежую сессию
      const latestSession = deviceSessions.reduce((latest, current) => {
        const latestTime = latest.last_seen ? new Date(latest.last_seen).getTime() : 0;
        const currentTime = current.last_seen ? new Date(current.last_seen).getTime() : 0;
        return currentTime > latestTime ? current : latest;
      });
      
      console.log('🎯 Самая свежая сессия:', latestSession.id, latestSession.name);
      
      // Проверяем актуальность сессии (15 минут)
      const lastSeenTime = latestSession.last_seen ? new Date(latestSession.last_seen).getTime() : 0;
      const isSessionActive = (now - lastSeenTime) < 15 * 60 * 1000;
      
      if (isSessionActive) {
        console.log('✅ Найдена активная сессия, восстанавливаем:', latestSession.id);
        userIdRef.current = latestSession.id;
        
        // Генерируем новую сессию
        const newSessionId = generateSessionId(deviceId);
        sessionIdRef.current = newSessionId;
        
        // Обновляем сессию на сервере
        await api.updateUser(latestSession.id, {
          session_id: newSessionId,
          online: true,
          last_seen: new Date().toISOString(),
          device_id: deviceId
        });
        
        // Восстанавливаем состояние
        await restoreUserSession(latestSession);
        
        // Сохраняем состояние
        await saveSessionState({
          userId: latestSession.id,
          nickname: latestSession.name,
          selectedCity: latestSession.city,
          selectedGender: latestSession.gender,
          clothingColor: latestSession.color,
          wagonNumber: latestSession.wagon,
          currentSelectedStation: latestSession.station,
          currentScreen: latestSession.is_connected ? 'joined' : 'waiting',
          timestamp: Date.now()
        });
        
        console.log('🔄 Сессия успешно восстановлена с сервера');
      } else {
        console.log('🕒 Сессия неактивна или устарела');
        setCurrentScreen('setup');
        await clearSessionState();
      }
      
    } catch (error) {
      console.error('❌ Ошибка проверки сессии:', error);
      setCurrentScreen('setup');
    }
  };

  // Восстановление сессии пользователя
  const restoreUserSession = async (userData) => {
    try {
      console.log('🔄 Восстанавливаем состояние пользователя:', userData.name);
      
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
        
        // Создаем группу
        const groupData = {
          station: userData.station,
          users: []
        };
        
        setCurrentGroup(groupData);
        setCurrentScreen('joined');
        
        // Загружаем участников группы
        setTimeout(() => {
          loadGroupMembers(userData.station);
          loadStationsMap();
        }, 100);
        
      } else if (userData.is_waiting) {
        // Пользователь был в режиме ожидания
        console.log('⏳ Восстанавливаем комнату ожидания');
        setCurrentScreen('waiting');
        loadStationsMap();
      }
    } catch (error) {
      console.error('❌ Ошибка восстановления сессии:', error);
      setCurrentScreen('setup');
    }
  };

  // Запуск глобального обновления
  const startGlobalRefresh = () => {
    const interval = setInterval(async () => {
      // Обновляем только если вкладка активна
      if (!isTabActiveRef.current) return;
      
      try {
        if (currentScreen === 'waiting') {
          await loadStationsMap();
        } else if (currentScreen === 'joined' && currentGroup) {
          await loadGroupMembers(currentGroup.station);
        }
        await improvedPingActivity();
      } catch (error) {
        console.warn('⚠️ Ошибка глобального обновления:', error.message);
      }
    }, 10000);
    
    globalRefreshIntervalRef.current = interval;
    return () => clearInterval(interval);
  };

  // Загрузка статистики станций
  const loadStationsMap = async () => {
    try {
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
      
      // Фильтруем пользователей на станции
      const groupUsers = users.filter(user => {
        const isOnStation = user.station === targetStation && user.is_connected === true;
        return isOnStation && user.online === true;
      });
      
      setGroupMembers(groupUsers);
    } catch (error) {
      console.error('Ошибка загрузки участников группы:', error);
      setGroupMembers([]);
    }
  };

  // Вход в комнату ожидания с валидацией
  const handleEnterWaitingRoom = async () => {
    console.log('🚪 Начинаем вход в комнату ожидания');
    
    if (!validateNickname()) {
      return;
    }
    
    setIsLoading(true);

    try {
      const trimmedNickname = nickname.trim();
      
      // Создаем новую сессию
      console.log('🆕 Создаем новую сессию');
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

      const createdUser = await api.createUser(userData);
      
      if (createdUser) {
        userIdRef.current = createdUser.id;
        sessionIdRef.current = newSessionId;
        console.log('✅ Создана новая сессия:', createdUser.id);
        
        // Сохраняем состояние сессии
        await saveSessionState({
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
        
        // Сбрасываем счетчик попыток восстановления
        sessionRestoreAttemptsRef.current = 0;
        
        setCurrentScreen('waiting');
        await loadStationsMap();
        
        try {
          bridge.send("VKWebAppShowSnackbar", {
            text: '✅ Профиль создан успешно'
          });
        } catch (error) {
          console.warn('⚠️ Ошибка показа уведомления:', error.message);
        }
      }
    } catch (error) {
      console.error('❌ ОШИБКА в handleEnterWaitingRoom:', error);
      try {
        bridge.send("VKWebAppShowSnackbar", {
          text: '❌ Ошибка создания сессии'
        });
      } catch (notifError) {
        console.warn('⚠️ Ошибка показа уведомления:', notifError.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Подтверждение выбора станции с валидацией
  const handleConfirmStation = async () => {
    console.log('📍 Начинаем подтверждение выбора станции');
    
    if (!validateClothingColor()) {
      return;
    }
    
    if (!validateStation()) {
      return;
    }

    if (!userIdRef.current) {
      console.error('❌ Нет userId, нельзя присоединиться к станции');
      try {
        bridge.send("VKWebAppShowSnackbar", {
          text: '❌ Ошибка: сначала создайте профиль'
        });
      } catch (error) {
        console.warn('⚠️ Ошибка показа уведомления:', error.message);
      }
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
      await saveSessionState({
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
      try {
        bridge.send("VKWebAppShowSnackbar", {
          text: `✅ Вы присоединились к станции ${currentSelectedStation}`
        });
      } catch (error) {
        console.warn('⚠️ Ошибка показа уведомления:', error.message);
      }
      
      // Загружаем участников группы
      setTimeout(() => {
        loadGroupMembers(currentSelectedStation);
      }, 100);
      
    } catch (error) {
      console.error('Ошибка при обновлении параметров:', error);
      try {
        bridge.send("VKWebAppShowSnackbar", {
          text: '❌ Ошибка: ' + (error.message || 'Неизвестная ошибка')
        });
      } catch (notifError) {
        console.warn('⚠️ Ошибка показа уведомления:', notifError.message);
      }
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
        await saveSessionState({
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
    try {
      bridge.send("VKWebAppShowSnackbar", {
        text: 'Вы вышли из комнаты станции'
      });
    } catch (error) {
      console.warn('⚠️ Ошибка показа уведомления:', error.message);
    }
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
    
    if (previousPosition !== position) {
      updateUserState();
    }
  };

  const handleMoodSelect = (mood) => {
    const previousMood = selectedMood;
    setSelectedMood(mood);
    
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
    } catch (error) {
      console.error('❌ Ошибка обновления состояния:', error);
    }
  };

  // Пинг активности
  const improvedPingActivity = async () => {
    if (!userIdRef.current) return false;
    
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
      
      try {
        bridge.send("VKWebAppShowSnackbar", {
          text: '❌ Пожалуйста, введите ваш никнейм'
        });
      } catch (error) {
        console.warn('⚠️ Ошибка показа уведомления:', error.message);
      }
      
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
      
      try {
        bridge.send("VKWebAppShowSnackbar", {
          text: '❌ Пожалуйста, укажите цвет верхней одежды или стиль'
        });
      } catch (error) {
        console.warn('⚠️ Ошибка показа уведомления:', error.message);
      }
      
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
      
      try {
        bridge.send("VKWebAppShowSnackbar", {
          text: '❌ Пожалуйста, выберите станцию на карте'
        });
      } catch (error) {
        console.warn('⚠️ Ошибка показа уведомления:', error.message);
      }
      
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
    const newNickname = e.target.value;
    setNickname(newNickname);
    
    if (newNickname.trim() && nicknameError) {
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
    const newColor = e.target.value;
    setClothingColor(newColor);
    
    if (newColor.trim() && clothingColorError) {
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

  // Навигация
  const showSetup = () => {
    previousSessionDataRef.current = null;
    setCurrentScreen('setup');
  };
  
  const showWaitingRoom = () => {
    if (!userIdRef.current) {
      if (!validateNickname()) {
        return;
      }
      try {
        bridge.send("VKWebAppShowSnackbar", {
          text: 'Сначала создайте профиль'
        });
      } catch (error) {
        console.warn('⚠️ Ошибка показа уведомления:', error.message);
      }
      return;
    }
    setCurrentScreen('waiting');
  };

  const showJoinedRoom = () => {
    if (!currentGroup) {
      try {
        bridge.send("VKWebAppShowSnackbar", {
          text: 'Сначала выберите станцию'
        });
      } catch (error) {
        console.warn('⚠️ Ошибка показа уведомления:', error.message);
      }
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

  // Отображение информации о сессии (только для разработки)
  const renderSessionInfo = () => {
    if (process.env.NODE_ENV === 'development') {
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
          🔄 Restore Attempts: {sessionRestoreAttemptsRef.current} |
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
          &copy; 2025 | Гаджи Латипов | Метрос | Санкт-Петербург
        </footer>
      </div>
    </div>
  );
};