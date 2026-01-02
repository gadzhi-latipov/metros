import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';

// Генерация уникального ID устройства с улучшенным хранением в VK Storage
const generateDeviceId = async () => {
  try {
    // Пытаемся получить deviceId из VK Storage
    const storedDeviceId = await getVKStorageItem('deviceId');
    
    if (storedDeviceId) {
      console.log('📱 Получен deviceId из VK Storage:', storedDeviceId);
      return storedDeviceId;
    }
    
    // Если нет в VK Storage, создаем новый
    const deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    
    // Сохраняем в VK Storage
    await setVKStorageItem('deviceId', deviceId);
    
    console.log('🆕 Создан новый deviceId:', deviceId);
    return deviceId;
  } catch (error) {
    console.error('❌ Ошибка при генерации deviceId:', error);
    // Fallback: генерируем временный ID
    return 'device_' + Math.random().toString(36).substr(2, 9);
  }
};

// Генерация сессии с учетом устройства
const generateSessionId = (deviceId) => {
  return `session_${deviceId}_${Date.now()}`;
};

// Функции для работы с VK Storage
const setVKStorageItem = async (key, value) => {
  try {
    if (!key || typeof key !== 'string') {
      console.error('❌ Ключ для VK Storage должен быть строкой');
      return false;
    }
    
    // Проверяем длину ключа (максимум 100 символов)
    if (key.length > 100) {
      console.error('❌ Ключ слишком длинный (максимум 100 символов)');
      return false;
    }
    
    // Проверяем допустимые символы в ключе
    const keyRegex = /^[a-zA-Z_\-0-9]+$/;
    if (!keyRegex.test(key)) {
      console.error('❌ Ключ содержит недопустимые символы. Допустимы только: буквы a-z, A-Z, цифры 0-9, _, -');
      return false;
    }
    
    // Обрезаем значение до 4096 символов для VK Storage
    const truncatedValue = typeof value === 'string' ? value.substring(0, 4096) : String(value).substring(0, 4096);
    
    const result = await bridge.send('VKWebAppStorageSet', {
      key: key,
      value: truncatedValue
    });
    
    if (result && result.result) {
      console.log('💾 Сохранено в VK Storage:', key);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ Ошибка сохранения в VK Storage:', error);
    return false;
  }
};

const getVKStorageItem = async (key) => {
  try {
    if (!key || typeof key !== 'string') {
      console.error('❌ Ключ для VK Storage должен быть строкой');
      return null;
    }
    
    const result = await bridge.send('VKWebAppStorageGet', {
      keys: [key]
    });
    
    if (result && result.keys && result.keys.length > 0) {
      const item = result.keys.find(item => item.key === key);
      if (item) {
        console.log('📂 Получено из VK Storage:', key);
        return item.value;
      }
    }
    
    return null;
  } catch (error) {
    console.error('❌ Ошибка получения из VK Storage:', error);
    return null;
  }
};

const removeVKStorageItem = async (key) => {
  try {
    const result = await bridge.send('VKWebAppStorageSet', {
      key: key,
      value: ''
    });
    
    if (result && result.result) {
      console.log('🧹 Удалено из VK Storage:', key);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ Ошибка удаления из VK Storage:', error);
    return false;
  }
};

// Сохранение состояния сессии в VK Storage
const saveSessionState = async (state) => {
  try {
    const sessionData = {
      ...state,
      timestamp: Date.now()
    };
    
    const sessionString = JSON.stringify(sessionData);
    
    // Сохраняем в VK Storage
    const saved = await setVKStorageItem('metro_session_state', sessionString);
    
    if (saved) {
      console.log('💾 Сохранено состояние сессии в VK Storage');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ Ошибка сохранения состояния сессии в VK Storage:', error);
    return false;
  }
};

// Загрузка состояния сессии из VK Storage
const loadSessionState = async () => {
  try {
    const sessionData = await getVKStorageItem('metro_session_state');
    
    if (sessionData) {
      const parsed = JSON.parse(sessionData);
      const now = Date.now();
      
      // Проверяем не устарело ли состояние (больше 1 часа)
      if (now - parsed.timestamp < 60 * 60 * 1000) {
        console.log('📂 Загружено сохраненное состояние сессии из VK Storage');
        return parsed;
      } else {
        console.log('🕒 Состояние сессии устарело (больше 1 часа)');
        await clearSessionState();
      }
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки состояния сессии из VK Storage:', error);
  }
  
  return null;
};

// Очистка состояния сессии из VK Storage
const clearSessionState = async () => {
  try {
    await removeVKStorageItem('metro_session_state');
    console.log('🧹 Очищено состояние сессии из VK Storage');
    return true;
  } catch (error) {
    console.error('❌ Ошибка очистки состояния сессии из VK Storage:', error);
    return false;
  }
};

// Сохранение всех настроек в VK Storage
const saveAllSettingsToVKStorage = async (settings) => {
  try {
    console.log('💾 Сохраняем все настройки в VK Storage');
    
    // Сохраняем каждую настройку отдельно
    const savePromises = Object.entries(settings).map(async ([key, value]) => {
      if (value !== undefined && value !== null) {
        await setVKStorageItem(key, String(value));
      }
    });
    
    await Promise.all(savePromises);
    
    console.log('✅ Все настройки сохранены в VK Storage');
    return true;
  } catch (error) {
    console.error('❌ Ошибка сохранения настроек в VK Storage:', error);
    return false;
  }
};

// Функция для установки пользователя в оффлайн (ТОЛЬКО ПРИ РЕАЛЬНОМ ЗАКРЫТИИ)
const setUserOffline = async (userId, sessionId, deviceId) => {
  if (!userId) return;
  
  try {
    console.log('👋 Устанавливаем пользователя в оффлайн:', userId);
    await api.updateUser(userId, { 
      online: false,
      last_seen: new Date().toISOString(),
      session_id: sessionId,
      device_id: deviceId
    });
    console.log('✅ Пользователь успешно установлен в оффлайн');
  } catch (error) {
    console.error('❌ Ошибка установки пользователя в оффлайн:', error);
  }
};

// Функция для установки пользователя в онлайн
const setUserOnline = async (userId, sessionId, deviceId) => {
  if (!userId) return;
  
  try {
    console.log('👋 Устанавливаем пользователя в онлайн:', userId);
    await api.updateUser(userId, { 
      online: true,
      last_seen: new Date().toISOString(),
      session_id: sessionId,
      device_id: deviceId
    });
    console.log('✅ Пользователь успешно установлен в онлайн');
  } catch (error) {
    console.error('❌ Ошибка установки пользователя в онлайн:', error);
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

// Улучшенная функция показа уведомлений
const showNotification = async (text, type = 'info') => {
  try {
    const truncatedText = text.length > 100 ? text.substring(0, 97) + '...' : text;
    console.log(`${type === 'error' ? '❌' : '✅'} ${truncatedText}`);
  } catch (error) {
    console.error('❌ Ошибка показа уведомления:', error);
  }
};

// Оптимизированный дебаунс
const createDebounce = () => {
  let timeoutId;
  return (func, wait) => {
    return (...args) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), wait);
    };
  };
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
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [deviceId, setDeviceId] = useState('');
  const [isSessionRestoring, setIsSessionRestoring] = useState(false);
  const [nicknameError, setNicknameError] = useState(false);
  const [clothingColorError, setClothingColorError] = useState(false);
  const [stationError, setStationError] = useState(false);
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  const [isColdStart, setIsColdStart] = useState(true);
  const [notificationText, setNotificationText] = useState('');
  
  const CACHE_DURATION = 60000; // Увеличиваем до 60 секунд
  const PING_INTERVAL = 120000; // Увеличиваем до 120 секунд (2 минуты)

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
  const appCloseHandlerRef = useRef(null);
  const backgroundPingIntervalRef = useRef(null);
  const isAppClosingRef = useRef(false);
  const lastApiCallRef = useRef(0);
  const apiCallCooldownRef = useRef(3000); // Увеличиваем задержку до 3 секунд
  const isInBackgroundRef = useRef(false);
  const pingTimeoutRef = useRef(null);
  const inputDebounceRef = useRef(createDebounce());
  const stationStatsCacheRef = useRef(new Map());
  const apiQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);
  const lastRenderTimeRef = useRef(0);
  const animationFrameRef = useRef(null);

  // Оптимизированная функция для API вызовов с очередью
  const safeApiCall = useCallback(async (apiFunction, ...args) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCallRef.current;
    
    // Если прошло меньше времени чем задержка, добавляем в очередь
    if (timeSinceLastCall < apiCallCooldownRef.current) {
      return new Promise((resolve, reject) => {
        apiQueueRef.current.push({
          apiFunction,
          args,
          resolve,
          reject,
          timestamp: now
        });
        
        if (!isProcessingQueueRef.current) {
          processApiQueue();
        }
      });
    }
    
    lastApiCallRef.current = Date.now();
    
    // Пытаемся выполнить запрос с повторными попытками
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await apiFunction(...args);
        return result;
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ Попытка ${attempt}/3 не удалась:`, error.message);
        
        if (attempt < 3) {
          // Ждем перед следующей попыткой
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    throw lastError || new Error('API вызов не удался после 3 попыток');
  }, []);

  // Обработка очереди API вызовов
  const processApiQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || apiQueueRef.current.length === 0) return;
    
    isProcessingQueueRef.current = true;
    
    while (apiQueueRef.current.length > 0) {
      const item = apiQueueRef.current.shift();
      const now = Date.now();
      const timeSinceLastCall = now - lastApiCallRef.current;
      
      if (timeSinceLastCall < apiCallCooldownRef.current) {
        await new Promise(resolve => setTimeout(resolve, apiCallCooldownRef.current - timeSinceLastCall));
      }
      
      lastApiCallRef.current = Date.now();
      
      try {
        const result = await item.apiFunction(...item.args);
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
    }
    
    isProcessingQueueRef.current = false;
  }, []);

  // Оптимизированная функция пинга
  const improvedPingActivity = useCallback(async () => {
    if (!userIdRef.current) return false;
    
    const now = Date.now();
    if (now - lastPingTime < 30000) return false; // Не пингуем чаще чем раз в 30 секунд
    
    try {
      const currentDeviceId = await generateDeviceId();
      
      const updateData = { 
        online: true,
        is_connected: currentScreen === 'joined',
        session_id: sessionIdRef.current,
        device_id: currentDeviceId,
        last_seen: new Date().toISOString(),
        ...(currentScreen === 'joined' && currentGroup && { 
          station: currentGroup.station 
        })
      };
      
      await safeApiCall(api.pingActivity, userIdRef.current, updateData);
      setLastPingTime(now);
      
      if (currentScreen === 'joined') {
        await loadGroupMembers();
      }
      
      return true;
    } catch (error) {
      console.error('Ошибка пинга активности:', error);
      return false;
    }
  }, [currentScreen, currentGroup, lastPingTime, safeApiCall, loadGroupMembers]);

  // Оптимизированная загрузка статистики станций с кешированием
  const loadStationsMap = useCallback(async () => {
    try {
      console.log('🗺️ Загрузка статистики станций для города:', selectedCity);
      
      // Проверяем кеш
      const cacheKey = `${selectedCity}_${Math.floor(Date.now() / CACHE_DURATION)}`;
      const cachedStats = stationStatsCacheRef.current.get(cacheKey);
      
      if (cachedStats) {
        console.log('📊 Используем кешированную статистику');
        setStationsData(cachedStats);
        return cachedStats;
      }
      
      const users = await safeApiCall(api.getUsers);
      
      // Рассчитываем статистику локально
      const stats = calculateStationsStats(users, selectedCity);
      
      // Кешируем результат
      stationStatsCacheRef.current.set(cacheKey, stats);
      // Ограничиваем размер кеша
      if (stationStatsCacheRef.current.size > 10) {
        const firstKey = stationStatsCacheRef.current.keys().next().value;
        stationStatsCacheRef.current.delete(firstKey);
      }
      
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
      const emptyStats = {
        stationStats: [],
        totalStats: { total_connected: 0, total_waiting: 0, total_users: 0 }
      };
      setStationsData(emptyStats);
      return emptyStats;
    }
  }, [selectedCity, safeApiCall, CACHE_DURATION]);

  // Оптимизированная загрузка участников группы
  const loadGroupMembers = useCallback(async (station = null) => {
    const targetStation = station || (currentGroup ? currentGroup.station : null);
    
    if (!targetStation) {
      setGroupMembers([]);
      return;
    }
    
    try {
      const users = await safeApiCall(api.getUsers);
      
      // Используем for для максимальной производительности
      const groupUsers = [];
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const isOnStation = user.station === targetStation && user.is_connected === true;
        
        // Если это текущий пользователь, проверяем его статус
        if (userIdRef.current && user.id === userIdRef.current) {
          if (isOnStation && user.online === true) {
            groupUsers.push(user);
          }
        } else if (isOnStation && user.online === true) {
          groupUsers.push(user);
        }
      }
      
      console.log(`👥 Загружено участников группы для станции ${targetStation}:`, groupUsers.length);
      setGroupMembers(groupUsers);
    } catch (error) {
      console.error('Ошибка загрузки участников группы:', error);
      setGroupMembers([]);
    }
  }, [currentGroup, safeApiCall]);

  // Оптимизированная загрузка всех пользователей
  const loadRequests = useCallback(async (forceRefresh = false) => {
    const now = Date.now();
    
    if (!forceRefresh && usersCache && (now - cacheTimestamp) < CACHE_DURATION) {
      setAllUsers(usersCache);
      return usersCache;
    }
    
    try {
      const users = await safeApiCall(api.getUsers);
      const activeUsers = users.filter(user => user.online === true);
      setAllUsers(activeUsers);
      setUsersCache(activeUsers);
      setCacheTimestamp(now);
      return activeUsers;
    } catch (error) {
      console.error('Ошибка загрузки запросов:', error);
      return usersCache || [];
    }
  }, [usersCache, cacheTimestamp, CACHE_DURATION, safeApiCall]);

  // ОЧЕНЬ БЫСТРЫЕ обработчики изменений (без задержек для UI)
  const handleNicknameChange = useCallback((e) => {
    const value = e.target.value;
    setNickname(value);
    if (nicknameError) {
      setNicknameError(false);
    }
  }, [nicknameError]);

  const handleClothingColorChange = useCallback((e) => {
    const value = e.target.value;
    setClothingColor(value);
    if (clothingColorError) {
      setClothingColorError(false);
    }
  }, [clothingColorError]);

  const handleStationSelect = useCallback((stationName) => {
    setCurrentSelectedStation(stationName);
    if (stationError) {
      setStationError(false);
    }
  }, [stationError]);

  // Оптимизированная валидация
  const validateNickname = useCallback(() => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setNicknameError(true);
      showNotification('Пожалуйста, введите ваш никнейм', 'error');
      return false;
    }
    
    setNicknameError(false);
    return true;
  }, [nickname]);

  const validateClothingColor = useCallback(() => {
    const trimmedColor = clothingColor.trim();
    if (!trimmedColor) {
      setClothingColorError(true);
      showNotification('Пожалуйста, укажите цвет верхней одежды или стиль', 'error');
      return false;
    }
    
    setClothingColorError(false);
    return true;
  }, [clothingColor]);

  const validateStation = useCallback(() => {
    if (!currentSelectedStation) {
      setStationError(true);
      showNotification('Пожалуйста, выберите станцию на карте', 'error');
      return false;
    }
    
    setStationError(false);
    return true;
  }, [currentSelectedStation]);

  // Оптимизированная генерация статуса пользователя
  const generateUserStatus = useCallback(() => {
    const positionPart = selectedPosition ? selectedPosition : '';
    const moodPart = selectedMood ? selectedMood : '';
    
    if (positionPart && moodPart) {
      return `${positionPart} | ${moodPart}`;
    } else if (positionPart || moodPart) {
      return positionPart || moodPart;
    } else {
      return 'Ожидание';
    }
  }, [selectedPosition, selectedMood]);

  // Оптимизированное обновление состояния пользователя с requestAnimationFrame
  const updateUserState = useCallback(async () => {
    if (!userIdRef.current) return;
    
    // Используем requestAnimationFrame для плавного обновления
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    animationFrameRef.current = requestAnimationFrame(async () => {
      try {
        const newStatus = generateUserStatus();
        const currentDeviceId = await generateDeviceId();
        
        await safeApiCall(api.updateUser, userIdRef.current, { 
          status: newStatus,
          position: selectedPosition,
          mood: selectedMood,
          session_id: sessionIdRef.current,
          device_id: currentDeviceId,
          last_seen: new Date().toISOString()
        });
        
        // Быстрое обновление локального состояния группы
        setGroupMembers(prevMembers => {
          const newMembers = [...prevMembers];
          for (let i = 0; i < newMembers.length; i++) {
            if (newMembers[i].id === userIdRef.current) {
              newMembers[i] = { 
                ...newMembers[i], 
                status: newStatus,
                position: selectedPosition,
                mood: selectedMood
              };
              break;
            }
          }
          return newMembers;
        });
        
        // Загружаем участников в фоне
        setTimeout(() => {
          loadGroupMembers();
        }, 100);
      } catch (error) {
        console.error('❌ Ошибка обновления состояния:', error);
      }
    });
  }, [selectedPosition, selectedMood, generateUserStatus, safeApiCall, loadGroupMembers]);

  // Оптимизированный вход в комнату ожидания с мгновенной реакцией
  const handleEnterWaitingRoom = useCallback(async () => {
    console.log('🚪 === НАЧАЛО handleEnterWaitingRoom ===');
    
    // Валидация никнейма
    if (!validateNickname()) {
      return;
    }
    
    setIsLoading(true);

    try {
      const trimmedNickname = nickname.trim();
      const currentDeviceId = await generateDeviceId();
      
      const newSessionId = generateSessionId(currentDeviceId);
      
      // Создаем нового пользователя
      console.log('🆕 Создаем новую сессию');
      
      const userData = {
        name: trimmedNickname,
        station: '',
        wagon: wagonNumber || '',
        color: clothingColor || '',
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
        device_id: currentDeviceId,
        vk_user_id: vkUserIdRef.current,
        last_seen: new Date().toISOString()
      };

      const createdUser = await safeApiCall(api.createUser, userData);
      
      if (createdUser) {
        userIdRef.current = createdUser.id;
        sessionIdRef.current = newSessionId;
        console.log('✅ Создана новая сессия:', createdUser.id);
        
        // Сохраняем состояние сессии в VK Storage (в фоне)
        setTimeout(async () => {
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
        }, 0);
        
        // Мгновенный переход на экран
        setCurrentScreen('waiting');
        
        // Загружаем данные в фоне
        setTimeout(async () => {
          await loadStationsMap();
          await loadRequests();
          
          showNotification('Профиль создан успешно', 'success');
        }, 100);
      }
    } catch (error) {
      console.error('❌ ОШИБКА в handleEnterWaitingRoom:', error);
      showNotification('Ошибка создания сессии', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [nickname, wagonNumber, clothingColor, selectedCity, selectedGender, validateNickname, safeApiCall, loadStationsMap, loadRequests]);

  // Оптимизированное подтверждение выбора станции
  const handleConfirmStation = useCallback(async () => {
    console.log('📍 === НАЧАЛО handleConfirmStation ===');
    
    // Проверка цвета одежды
    if (!validateClothingColor()) {
      return;
    }
    
    // Проверка никнейма
    if (!nickname || nickname.trim() === '') {
      showNotification('Пожалуйста, введите ваш никнейм', 'error');
      return;
    }
    
    // Проверка выбора станции
    if (!validateStation()) {
      return;
    }

    if (!userIdRef.current) {
      console.error('❌ Нет userId, нельзя присоединиться к станции');
      showNotification('Ошибка: сначала создайте профиль', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const currentDeviceId = await generateDeviceId();
      
      // Обновляем пользователя
      await safeApiCall(api.updateUser, userIdRef.current, {
        station: currentSelectedStation,
        wagon: wagonNumber,
        color: clothingColor.trim(),
        name: nickname.trim(),
        is_waiting: false,
        is_connected: true,
        online: true,
        session_id: sessionIdRef.current,
        device_id: currentDeviceId,
        last_seen: new Date().toISOString(),
        status: 'Выбрал станцию: ' + currentSelectedStation
      });

      // Мгновенное обновление UI
      const groupData = {
        station: currentSelectedStation,
        users: []
      };
      
      setCurrentGroup(groupData);
      setCurrentScreen('joined');
      
      // Сохраняем состояние сессии в VK Storage (в фоне)
      setTimeout(async () => {
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
      }, 0);
      
      // Показываем успешное уведомление
      showNotification(`Вы присоединились к станции ${currentSelectedStation}`, 'success');
      
      // Загружаем участников группы в фоне
      setTimeout(async () => {
        await loadGroupMembers(currentSelectedStation);
        await loadRequests(true);
      }, 100);
      
    } catch (error) {
      console.error('Ошибка при обновлении параметров:', error);
      showNotification('Ошибка: ' + (error.message || 'Неизвестная ошибка'), 'error');
    } finally {
      setIsLoading(false);
    }
  }, [validateClothingColor, nickname, validateStation, currentSelectedStation, wagonNumber, clothingColor, selectedCity, selectedGender, safeApiCall, loadGroupMembers, loadRequests]);

  // Оптимизированный выход из группы
  const handleLeaveGroup = useCallback(async () => {
    if (userIdRef.current) {
      try {
        const currentDeviceId = await generateDeviceId();
        
        await safeApiCall(api.updateUser, userIdRef.current, { 
          status: 'Ожидание',
          is_waiting: true,
          is_connected: false,
          station: '',
          session_id: sessionIdRef.current,
          device_id: currentDeviceId,
          last_seen: new Date().toISOString()
        });
        console.log('✅ Пользователь вышел из группы');
        
        // Обновляем сохраненное состояние в VK Storage (в фоне)
        setTimeout(async () => {
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
        }, 0);
      } catch (error) {
        console.error('Ошибка при обновлении пользователя:', error);
      }
    }
    
    // Мгновенное обновление UI
    setCurrentGroup(null);
    setCurrentScreen('waiting');
    setSelectedPosition('');
    setSelectedMood('');
    
    // Показываем уведомление
    showNotification('Вы вышли из комнаты станции', 'info');
  }, [nickname, selectedCity, selectedGender, clothingColor, wagonNumber, safeApiCall]);

  // Оптимизированные обработчики выбора (без задержек)
  const handleCitySelect = useCallback((city) => {
    setSelectedCity(city);
    // Очищаем кеш статистики при смене города
    stationStatsCacheRef.current.clear();
  }, []);

  const handleGenderSelect = useCallback((gender) => {
    setSelectedGender(gender);
  }, []);

  const handlePositionSelect = useCallback((position) => {
    const previousPosition = selectedPosition;
    setSelectedPosition(position);
    
    if (previousPosition !== position) {
      // Обновляем состояние пользователя без блокировки UI
      setTimeout(() => {
        updateUserState();
      }, 0);
    }
  }, [selectedPosition, updateUserState]);

  const handleMoodSelect = useCallback((mood) => {
    const previousMood = selectedMood;
    setSelectedMood(mood);
    
    if (previousMood !== mood) {
      setTimeout(() => {
        updateUserState();
      }, 0);
    }
  }, [selectedMood, updateUserState]);

  const handleTimerSelect = useCallback((minutes) => {
    setSelectedMinutes(minutes);
  }, []);

  // Оптимизированный рендер карты станций
  const renderStationsMap = useCallback(() => {
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
    
    // Используем Map для быстрого поиска
    const stationsMap = new Map();
    stationStats.forEach(station => {
      stationsMap.set(station.station, station);
    });
    
    // Используем requestAnimationFrame для плавного рендеринга
    const renderItems = [];
    
    for (let i = 0; i < cityStations.length; i++) {
      const stationName = cityStations[i];
      const stationData = stationsMap.get(stationName);
      
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
      
      renderItems.push(
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
    }
    
    return renderItems;
  }, [stationsData, selectedCity, currentSelectedStation, handleStationSelect]);

  // Оптимизированный рендер участников группы
  const renderGroupMembers = useCallback(() => {
    if (groupMembers.length === 0) {
      return <div className="no-requests">Нет участников на этой станции</div>;
    }
    
    const renderItems = [];
    
    for (let i = 0; i < groupMembers.length; i++) {
      const user = groupMembers[i];
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
      
      renderItems.push(
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
    }
    
    return renderItems;
  }, [groupMembers]);

  // Оптимизированная инициализация приложения
  useEffect(() => {
    console.log('✅ React компонент App загружен');
    
    // Инициализация устройства
    const initializeDevice = async () => {
      try {
        const generatedDeviceId = await generateDeviceId();
        setDeviceId(generatedDeviceId);
        console.log('📱 Идентификатор устройства:', generatedDeviceId);
      } catch (error) {
        console.error('❌ Ошибка инициализации устройства:', error);
        const fallbackDeviceId = 'device_' + Math.random().toString(36).substr(2, 9);
        setDeviceId(fallbackDeviceId);
      }
    };
    
    initializeDevice();
    
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
        console.log('📱 Приложение ушло в фон');
        isInBackgroundRef.current = true;
        setAppState('background');
      } else {
        console.log('📱 Приложение активно');
        isInBackgroundRef.current = false;
        setAppState('active');
        // При возвращении на передний план - отправляем пинг
        if (userIdRef.current) {
          improvedPingActivity();
        }
      }
    };

    // Обработчик реального закрытия приложения
    const handleBeforeUnload = async (event) => {
      console.log('⚠️ Приложение закрывается - устанавливаем оффлайн');
      isAppClosingRef.current = true;
      
      // Очищаем все таймеры и интервалы
      if (pingTimeoutRef.current) {
        clearTimeout(pingTimeoutRef.current);
      }
      if (backgroundPingIntervalRef.current) {
        clearInterval(backgroundPingIntervalRef.current);
      }
      
      // Устанавливаем пользователя в оффлайн
      if (userIdRef.current) {
        try {
          const currentDeviceId = await generateDeviceId();
          await setUserOffline(userIdRef.current, sessionIdRef.current, currentDeviceId);
        } catch (error) {
          console.error('❌ Ошибка при установке оффлайн:', error);
        }
      }
    };

    // Подписка на события видимости страницы
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Подписка на события реального закрытия
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Подписка на события VK Bridge
    const bridgeUnsubscribe = bridge.subscribe((event) => {
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
          isInBackgroundRef.current = true;
          setAppState('background');
          break;
        case 'VKWebAppViewRestore':
          console.log('📱 VKWebAppViewRestore - приложение восстановлено');
          isInBackgroundRef.current = false;
          setAppState('active');
          // При восстановлении обновляем статус
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
        
        // Пытаемся загрузить сохраненное состояние из VK Storage
        const savedState = await loadSessionState();
        
        if (savedState) {
          console.log('📂 Используем сохраненное состояние сессии из VK Storage');
          
          // Восстанавливаем состояние из сохраненных данных
          await restoreFromSavedState(savedState);
        } else {
          console.log('🆕 Нет сохраненного состояния, начинаем с сервера');
          
          // Пытаемся восстановить с сервера
          await checkAndRestoreSession();
        }
      } catch (error) {
        console.error('❌ Критическая ошибка восстановления сессии:', error);
        setCurrentScreen('setup');
        showNotification('Ошибка восстановления сессии', 'error');
      } finally {
        setIsSessionRestoring(false);
        sessionRestoreInProgressRef.current = false;
        setIsColdStart(false);
      }
    };
    
    restoreSession();
    
    // Запуск глобального обновления с увеличенным интервалом
    const cleanupGlobalRefresh = startGlobalRefresh();

    // Запуск периодического пинга
    const startPeriodicPing = () => {
      return setInterval(async () => {
        if (userIdRef.current && !isInBackgroundRef.current) {
          await improvedPingActivity();
        }
      }, PING_INTERVAL);
    };

    const pingInterval = startPeriodicPing();

    // Очистка при размонтировании
    return () => {
      console.log('🧹 Очистка компонента');
      
      // Удаляем обработчики событий
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      // Отписываемся от событий VK Bridge
      if (bridgeUnsubscribe) {
        bridgeUnsubscribe();
      }
      
      // Очищаем все таймеры и интервалы
      if (pingTimeoutRef.current) {
        clearTimeout(pingTimeoutRef.current);
      }
      if (pingInterval) {
        clearInterval(pingInterval);
      }
      if (backgroundPingIntervalRef.current) {
        clearInterval(backgroundPingIntervalRef.current);
      }
      if (globalRefreshIntervalRef.current) {
        clearInterval(globalRefreshIntervalRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // Устанавливаем пользователя в оффлайн только если это реальное закрытие
      if (isAppClosingRef.current && userIdRef.current) {
        const currentDeviceId = deviceId || 'device_' + Math.random().toString(36).substr(2, 9);
        setUserOffline(userIdRef.current, sessionIdRef.current, currentDeviceId);
      }
      
      cleanupGlobalRefresh();
    };
  }, []);

  // Восстановление из сохраненного состояния из VK Storage
  const restoreFromSavedState = useCallback(async (savedState) => {
    try {
      console.log('🔄 Восстанавливаем из сохраненного состояния:', savedState);
      
      // Восстанавливаем локальное состояние
      if (savedState.nickname) setNickname(savedState.nickname);
      if (savedState.selectedCity) setSelectedCity(savedState.selectedCity);
      if (savedState.selectedGender) setSelectedGender(savedState.selectedGender);
      if (savedState.clothingColor) setClothingColor(savedState.clothingColor);
      if (savedState.wagonNumber) setWagonNumber(savedState.wagonNumber);
      if (savedState.currentSelectedStation) setCurrentSelectedStation(savedState.currentSelectedStation);
      
      // Загружаем текущий deviceId
      const currentDeviceId = await generateDeviceId();
      
      try {
        // Получаем всех пользователей с сервера
        const users = await safeApiCall(api.getUsers);
        
        // Ищем сессию по нескольким параметрам
        let serverSession = null;
        
        // 1. Сначала ищем по userId (если есть в savedState)
        if (savedState.userId) {
          serverSession = users.find(user => user.id === savedState.userId);
          if (serverSession) {
            console.log('✅ Нашли сессию по userId:', savedState.userId);
          }
        }
        
        // 2. Если не нашли по userId, ищем по deviceId и имени
        if (!serverSession && savedState.nickname) {
          serverSession = users.find(user => 
            user.device_id === currentDeviceId && 
            user.name === savedState.nickname &&
            user.online === true
          );
          if (serverSession) {
            console.log('✅ Нашли сессию по deviceId и имени:', serverSession.id);
          }
        }
        
        // 3. Если все еще не нашли, ищем по deviceId (любую активную сессию)
        if (!serverSession) {
          serverSession = users.find(user => 
            user.device_id === currentDeviceId &&
            user.online === true
          );
          if (serverSession) {
            console.log('✅ Нашли сессию по deviceId:', serverSession.id);
          }
        }
        
        if (serverSession) {
          // Сессия найдена на сервере
          console.log('✅ Сессия найдена на сервере, продолжаем восстановление');
          
          // Сохраняем userId для использования
          userIdRef.current = serverSession.id;
          
          // Обновляем сессию и устанавливаем онлайн
          const newSessionId = generateSessionId(currentDeviceId);
          sessionIdRef.current = newSessionId;
          
          // Устанавливаем пользователя онлайн
          await setUserOnline(serverSession.id, newSessionId, currentDeviceId);
          
          // Восстанавливаем данные пользователя из сервера (они могут быть актуальнее)
          await restoreUserSession(serverSession);
          
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
            
          } else if (serverSession.is_waiting || !serverSession.is_connected) {
            // Восстанавливаем комнату ожидания
            setCurrentScreen('waiting');
            
            // Загружаем данные
            await loadRequests();
            
            showNotification('Сессия восстановлена', 'info');
          } else {
            // Непонятное состояние - показываем настройки
            setCurrentScreen('setup');
          }
          
          // Обновляем сохраненное состояние с актуальными данными
          await saveSessionState({
            userId: serverSession.id,
            nickname: serverSession.name || savedState.nickname,
            selectedCity: serverSession.city || savedState.selectedCity || 'spb',
            selectedGender: serverSession.gender || savedState.selectedGender || 'male',
            clothingColor: serverSession.color || savedState.clothingColor || '',
            wagonNumber: serverSession.wagon || savedState.wagonNumber || '',
            currentSelectedStation: serverSession.station || savedState.currentSelectedStation,
            currentScreen: serverSession.is_connected ? 'joined' : 'waiting',
            timestamp: Date.now()
          });
          
        } else {
          // Сессии нет на сервере, начинаем заново
          console.log('❌ Сессия не найдена на сервере, начинаем заново');
          setCurrentScreen('setup');
          await clearSessionState();
          showNotification('Сессия устарела, создайте новую', 'info');
        }
      } catch (apiError) {
        console.error('❌ Ошибка API при восстановлении сессии:', apiError);
        // Показываем setup экран при ошибке API
        setCurrentScreen('setup');
        showNotification('Ошибка подключения к серверу', 'error');
      }
      
    } catch (error) {
      console.error('❌ Ошибка восстановления из сохраненного состояния:', error);
      setCurrentScreen('setup');
    }
  }, [safeApiCall, loadStationsMap, loadGroupMembers, loadRequests]);

  // Проверка и восстановление сессии с сервера
  const checkAndRestoreSession = useCallback(async () => {
    try {
      const currentDeviceId = await generateDeviceId();
      console.log('🔍 Ищем активные сессии для устройства:', currentDeviceId);
      
      try {
        const users = await safeApiCall(api.getUsers);
        
        // Ищем самую свежую сессию для этого устройства
        const deviceSessions = users.filter(user => 
          user.device_id === currentDeviceId &&
          user.online === true
        );
        
        console.log(`📊 Найдено активных сессий для устройства ${currentDeviceId}:`, deviceSessions.length);
        
        if (deviceSessions.length === 0) {
          console.log('🆕 Нет активных сессий для этого устройства, начинаем с настройки');
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
        
        // Восстанавливаем сессию
        console.log('✅ Восстанавливаем сессию:', latestSession.id);
        userIdRef.current = latestSession.id;
        
        // Генерируем новую сессию
        const newSessionId = generateSessionId(currentDeviceId);
        sessionIdRef.current = newSessionId;
        
        // Восстанавливаем состояние и устанавливаем онлайн
        await restoreUserSession(latestSession);
        
        // Устанавливаем пользователя в онлайн
        await setUserOnline(latestSession.id, newSessionId, currentDeviceId);
        
        // Сохраняем состояние в VK Storage
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
        showNotification('Сессия восстановлена', 'info');
        
      } catch (apiError) {
        console.error('❌ Ошибка API при проверке сессии:', apiError);
        setCurrentScreen('setup');
        showNotification('Ошибка подключения к серверу', 'error');
      }
      
    } catch (error) {
      console.error('❌ Ошибка проверки сессии:', error);
      setCurrentScreen('setup');
    }
  }, [safeApiCall]);

  // Восстановление сессии пользователя
  const restoreUserSession = useCallback(async (userData) => {
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
        
      } else if (userData.is_waiting || !userData.is_connected) {
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
  }, [loadStationsMap, loadGroupMembers]);

  // Запуск глобального обновления
  const startGlobalRefresh = useCallback(() => {
    const interval = setInterval(async () => {
      try {
        if (currentScreen === 'waiting') {
          await loadStationsMap();
          await loadRequests();
        } else if (currentScreen === 'joined' && currentGroup) {
          await loadGroupMembers(currentGroup.station);
          await loadRequests();
        }
      } catch (error) {
        console.error('❌ Ошибка глобального обновления:', error);
      }
    }, 120000); // Увеличиваем интервал до 120 секунд (2 минуты)
    
    globalRefreshIntervalRef.current = interval;
    return () => clearInterval(interval);
  }, [currentScreen, currentGroup, loadStationsMap, loadRequests, loadGroupMembers]);

  // Оптимизированный useEffect для сохранения настроек
  useEffect(() => {
    const saveSettings = async () => {
      try {
        const settings = {
          selectedCity,
          selectedGender,
          selectedPosition,
          selectedMood,
          selectedStation: currentSelectedStation,
          selectedTimerMinutes: selectedMinutes,
          nickname,
          clothingColor,
          wagonNumber,
          currentScreen
        };
        
        await saveAllSettingsToVKStorage(settings);
        
        // Также сохраняем полное состояние сессии
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
          
          await saveSessionState(sessionState);
        }
      } catch (error) {
        console.error('❌ Ошибка сохранения настроек в VK Storage:', error);
      }
    };
    
    // Сохраняем без задержки, но используем requestAnimationFrame для плавности
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    animationFrameRef.current = requestAnimationFrame(() => {
      saveSettings();
    });
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    selectedCity, selectedGender, selectedPosition, selectedMood,
    currentSelectedStation, selectedMinutes, nickname, clothingColor,
    wagonNumber, currentScreen, currentGroup, isColdStart
  ]);

  // Оптимизированный useEffect для обработки онлайн/оффлайн статуса
  useEffect(() => {
    const handleOnline = async () => {
      console.log('🌐 Интернет восстановлен');
      setIsOnline(true);
      
      // Если был в joined, восстанавливаем сессию
      if (userIdRef.current && (currentScreen === 'joined' || currentScreen === 'waiting')) {
        try {
          const currentDeviceId = await generateDeviceId();
          await setUserOnline(userIdRef.current, sessionIdRef.current, currentDeviceId);
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
      setNotificationText('⚠️ Потеряно соединение с интернетом');
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [currentScreen, currentGroup, deviceId, loadStationsMap, loadRequests, loadGroupMembers]);

  // Оптимизированные навигационные функции
  const showSetup = useCallback(() => setCurrentScreen('setup'), []);
  const showWaitingRoom = useCallback(() => {
    if (!userIdRef.current) {
      if (!validateNickname()) {
        return;
      }
      showNotification('Сначала создайте профиль', 'info');
      return;
    }
    setCurrentScreen('waiting');
  }, [validateNickname]);

  const showJoinedRoom = useCallback(() => {
    if (!currentGroup) {
      showNotification('Сначала выберите станцию', 'info');
      return;
    }
    setCurrentScreen('joined');
  }, [currentGroup]);

  // Отображение информации о сессии
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
          📊 Stats: {stationsData.totalStats?.total_connected || 0}✅ {stationsData.totalStats?.total_waiting || 0}⏳ |
          📱 State: {appState}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="app-container">
      {renderSessionInfo()}
      
      {notificationText && (
        <div className="notification" style={{
          position: 'fixed',
          top: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#333',
          color: 'white',
          padding: '10px 20px',
          borderRadius: '5px',
          zIndex: 1000,
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
        }}>
          {notificationText}
          <button 
            onClick={() => setNotificationText('')}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              marginLeft: '10px',
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>
      )}
      
      {!isOnline && (
        <div className="offline-indicator">
          ⚠️ Отсутствует соединение с интернетом (но вы остаетесь онлайн)
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
          &copy; 2026 | Гаджи Латипов | Метрос | Санкт Петербург
        </footer>
      </div>
    </div>
  );
};