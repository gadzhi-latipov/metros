import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';

// Генерация уникального ID устройства с улучшенным хранением в VK Storage
const generateDeviceId = async () => {
  try {
    const storedDeviceId = await getVKStorageItem('deviceId');
    if (storedDeviceId) {
      console.log('📱 Получен deviceId из VK Storage:', storedDeviceId);
      return storedDeviceId;
    }
    
    const deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    await setVKStorageItem('deviceId', deviceId);
    console.log('🆕 Создан новый deviceId:', deviceId);
    return deviceId;
  } catch (error) {
    console.error('❌ Ошибка при генерации deviceId:', error);
    return 'device_' + Math.random().toString(36).substr(2, 9);
  }
};

// Генерация сессии с учетом устройства
const generateSessionId = (deviceId) => `session_${deviceId}_${Date.now()}`;

// Функции для работы с VK Storage
const setVKStorageItem = async (key, value) => {
  try {
    if (!key || typeof key !== 'string' || key.length > 100) return false;
    
    const keyRegex = /^[a-zA-Z_\-0-9]+$/;
    if (!keyRegex.test(key)) return false;
    
    const truncatedValue = typeof value === 'string' 
      ? value.substring(0, 4096) 
      : String(value).substring(0, 4096);
    
    const result = await bridge.send('VKWebAppStorageSet', {
      key: key,
      value: truncatedValue
    });
    
    return !!(result && result.result);
  } catch (error) {
    console.error('❌ Ошибка сохранения в VK Storage:', error);
    return false;
  }
};

const getVKStorageItem = async (key) => {
  try {
    if (!key || typeof key !== 'string') return null;
    
    const result = await bridge.send('VKWebAppStorageGet', {
      keys: [key]
    });
    
    if (result?.keys?.length > 0) {
      const item = result.keys.find(item => item.key === key);
      return item?.value || null;
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
    
    return !!(result && result.result);
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
    const saved = await setVKStorageItem('metro_session_state', sessionString);
    
    if (saved) {
      console.log('💾 Сохранено состояние сессии в VK Storage');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ Ошибка сохранения состояния сессии:', error);
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
      
      if (now - parsed.timestamp < 60 * 60 * 1000) {
        console.log('📂 Загружено сохраненное состояние сессии');
        return parsed;
      } else {
        console.log('🕒 Состояние сессии устарело (больше 1 часа)');
        await clearSessionState();
      }
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки состояния сессии:', error);
  }
  
  return null;
};

// Очистка состояния сессии из VK Storage
const clearSessionState = async () => {
  try {
    await removeVKStorageItem('metro_session_state');
    console.log('🧹 Очищено состояние сессии');
    return true;
  } catch (error) {
    console.error('❌ Ошибка очистки состояния сессии:', error);
    return false;
  }
};

// Сохранение всех настроек в VK Storage
const saveAllSettingsToVKStorage = async (settings) => {
  try {
    console.log('💾 Сохраняем все настройки в VK Storage');
    
    const savePromises = Object.entries(settings).map(async ([key, value]) => {
      if (value !== undefined && value !== null) {
        await setVKStorageItem(key, String(value));
      }
    });
    
    await Promise.all(savePromises);
    console.log('✅ Все настройки сохранены');
    return true;
  } catch (error) {
    console.error('❌ Ошибка сохранения настроек:', error);
    return false;
  }
};

// Функция для установки пользователя в оффлайн
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
    console.log('✅ Пользователь в оффлайне');
  } catch (error) {
    console.error('❌ Ошибка установки оффлайн:', error);
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
    console.log('✅ Пользователь в онлайне');
  } catch (error) {
    console.error('❌ Ошибка установки онлайн:', error);
  }
};

// Функция для вычисления статистики станций
const calculateStationsStats = (users, city) => {
  try {
    console.log('📊 Вычисляем статистику станций для города:', city);
    
    const stationStats = {};
    let total_connected = 0;
    let total_waiting = 0;
    
    const cityStations = helpers.stations[city] || [];
    
    cityStations.forEach(station => {
      stationStats[station] = {
        station: station,
        waiting: 0,
        connected: 0,
        totalUsers: 0
      };
    });
    
    users.forEach(user => {
      if (user.online !== true) return;
      
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
    
    const stationStatsArray = Object.values(stationStats);
    
    console.log('📈 Статистика рассчитана');
    
    return {
      stationStats: stationStatsArray,
      totalStats: {
        total_connected,
        total_waiting,
        total_users: total_connected + total_waiting
      }
    };
  } catch (error) {
    console.error('❌ Ошибка расчета статистики:', error);
    return {
      stationStats: [],
      totalStats: { total_connected: 0, total_waiting: 0, total_users: 0 }
    };
  }
};

// Дебаунс функция
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

export const App = () => {
  // Состояния
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
  
  const CACHE_DURATION = 60000;
  const PING_INTERVAL = 120000;

  // Рефы
  const userIdRef = useRef(null);
  const globalRefreshIntervalRef = useRef(null);
  const sessionIdRef = useRef('');
  const vkUserIdRef = useRef(null);
  const nicknameInputRef = useRef(null);
  const clothingColorInputRef = useRef(null);
  const metroMapRef = useRef(null);
  const isInitialMountRef = useRef(true);
  const sessionRestoreInProgressRef = useRef(false);
  const appCloseHandlerRef = useRef(null);
  const backgroundPingIntervalRef = useRef(null);
  const isAppClosingRef = useRef(false);
  const lastApiCallRef = useRef(0);
  const apiCallCooldownRef = useRef(3000);
  const isInBackgroundRef = useRef(false);
  const pingTimeoutRef = useRef(null);
  const saveSettingsTimeoutRef = useRef(null);
  const updateStatusTimeoutRef = useRef(null);

  // Оптимизированная функция для API вызовов
  const safeApiCall = useCallback(async (apiFunction, ...args) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCallRef.current;
    
    if (timeSinceLastCall < apiCallCooldownRef.current) {
      const waitTime = apiCallCooldownRef.current - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastApiCallRef.current = Date.now();
    
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await apiFunction(...args);
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ Попытка ${attempt}/3 не удалась:`, error.message);
        
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    throw lastError || new Error('API вызов не удался после 3 попыток');
  }, []);

  // Оптимизированная функция пинга
  const improvedPingActivity = useCallback(async () => {
    if (!userIdRef.current) return false;
    
    const now = Date.now();
    if (now - lastPingTime < 30000) return false;
    
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
  }, [currentScreen, currentGroup, lastPingTime, safeApiCall]);

  // Оптимизированная загрузка данных
  const loadStationsMap = useCallback(async () => {
    try {
      console.log('🗺️ Загрузка статистики станций для города:', selectedCity);
      
      const users = await safeApiCall(api.getUsers);
      const stats = calculateStationsStats(users, selectedCity);
      
      setStationsData(stats);
      
      const activeUsers = users.filter(user => user.online === true);
      setAllUsers(activeUsers);
      setUsersCache(activeUsers);
      setCacheTimestamp(Date.now());
      
      console.log('✅ Статистика загружена');
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
  }, [selectedCity, safeApiCall]);

  const loadGroupMembers = useCallback(async (station = null) => {
    const targetStation = station || (currentGroup ? currentGroup.station : null);
    
    if (!targetStation) {
      setGroupMembers([]);
      return;
    }
    
    try {
      const users = await safeApiCall(api.getUsers);
      const groupUsers = users.filter(user => {
        const isOnStation = user.station === targetStation && user.is_connected === true;
        
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
  }, [currentGroup, safeApiCall]);

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
  }, [usersCache, cacheTimestamp, safeApiCall]);

  // Оптимизированные обработчики изменений
  const handleNicknameChange = useCallback((e) => {
    setNickname(e.target.value);
    if (nicknameError) setNicknameError(false);
  }, [nicknameError]);

  const handleClothingColorChange = useCallback((e) => {
    setClothingColor(e.target.value);
    if (clothingColorError) setClothingColorError(false);
  }, [clothingColorError]);

  const handleStationSelect = useCallback((stationName) => {
    setCurrentSelectedStation(stationName);
    if (stationError) setStationError(false);
  }, [stationError]);

  // Валидация
  const validateNickname = useCallback(() => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setNicknameError(true);
      return false;
    }
    setNicknameError(false);
    return true;
  }, [nickname]);

  const validateClothingColor = useCallback(() => {
    const trimmedColor = clothingColor.trim();
    if (!trimmedColor) {
      setClothingColorError(true);
      return false;
    }
    setClothingColorError(false);
    return true;
  }, [clothingColor]);

  const validateStation = useCallback(() => {
    if (!currentSelectedStation) {
      setStationError(true);
      return false;
    }
    setStationError(false);
    return true;
  }, [currentSelectedStation]);

  // Генерация статуса пользователя
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

  // Оптимизированное обновление состояния пользователя с дебаунсом
  const debouncedUpdateUserState = useCallback(
    debounce(async () => {
      if (!userIdRef.current) return;
      
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
    }, 1000),
    [selectedPosition, selectedMood, safeApiCall, loadGroupMembers, generateUserStatus]
  );

  // Оптимизированный вход в комнату ожидания
  const handleEnterWaitingRoom = useCallback(async () => {
    if (!validateNickname()) return;
    
    setIsLoading(true);

    try {
      const trimmedNickname = nickname.trim();
      const currentDeviceId = await generateDeviceId();
      const newSessionId = generateSessionId(currentDeviceId);
      
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
        
        setCurrentScreen('waiting');
        await Promise.all([loadStationsMap(), loadRequests()]);
      }
    } catch (error) {
      console.error('❌ ОШИБКА в handleEnterWaitingRoom:', error);
    } finally {
      setIsLoading(false);
    }
  }, [nickname, wagonNumber, clothingColor, selectedCity, selectedGender, validateNickname, safeApiCall, loadStationsMap, loadRequests]);

  // Оптимизированное подтверждение выбора станции
  const handleConfirmStation = useCallback(async () => {
    if (!validateClothingColor() || !nickname || !validateStation()) return;
    
    if (!userIdRef.current) return;

    setIsLoading(true);
    try {
      const currentDeviceId = await generateDeviceId();
      
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

      const users = await safeApiCall(api.getUsers);
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
      
      setTimeout(() => {
        loadGroupMembers(currentSelectedStation);
        loadRequests(true);
      }, 100);
      
    } catch (error) {
      console.error('Ошибка при обновлении параметров:', error);
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
  }, [nickname, selectedCity, selectedGender, clothingColor, wagonNumber, safeApiCall]);

  // Оптимизированные обработчики выбора
  const handleCitySelect = useCallback((city) => setSelectedCity(city), []);
  const handleGenderSelect = useCallback((gender) => setSelectedGender(gender), []);
  const handleTimerSelect = useCallback((minutes) => setSelectedMinutes(minutes), []);

  const handlePositionSelect = useCallback((position) => {
    setSelectedPosition(position);
    debouncedUpdateUserState();
  }, [debouncedUpdateUserState]);

  const handleMoodSelect = useCallback((mood) => {
    setSelectedMood(mood);
    debouncedUpdateUserState();
  }, [debouncedUpdateUserState]);

  // Оптимизированный рендер карты станций с мемоизацией
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
    
    const cityStations = helpers.stations[selectedCity] || [];
    const stationsMap = {};
    stationStats.forEach(station => {
      stationsMap[station.station] = station;
    });
    
    return cityStations.map(stationName => {
      const stationData = stationsMap[stationName];
      let stationClass = 'empty';
      
      if (stationData) {
        const waitingCount = stationData.waiting || 0;
        const connectedCount = stationData.connected || 0;
        
        if (connectedCount > 0) {
          stationClass = 'connected';
        } else if (waitingCount > 0) {
          stationClass = 'waiting';
        }
      }
      
      const totalCount = stationData ? (stationData.waiting || 0) + (stationData.connected || 0) : 0;
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
              {stationData.waiting > 0 && <span className="station-count count-waiting">{stationData.waiting}⏳</span>}
              {stationData.connected > 0 && <span className="station-count count-connected">{stationData.connected}✅</span>}
            </div>
          ) : (
            <div style={{fontSize: '10px', color: '#666'}}>Пусто</div>
          )}
        </div>
      );
    });
  }, [stationsData, selectedCity, currentSelectedStation, handleStationSelect]);

  // Оптимизированный рендер участников группы
  const renderGroupMembers = useCallback(() => {
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
  }, [groupMembers]);

  // Оптимизированные навигационные функции
  const showSetup = useCallback(() => setCurrentScreen('setup'), []);
  const showWaitingRoom = useCallback(() => {
    if (!userIdRef.current) {
      if (!validateNickname()) return;
      return;
    }
    setCurrentScreen('waiting');
  }, [validateNickname]);

  const showJoinedRoom = useCallback(() => {
    if (!currentGroup) return;
    setCurrentScreen('joined');
  }, [currentGroup]);

  // Оптимизированный useEffect для сохранения настроек
  useEffect(() => {
    if (saveSettingsTimeoutRef.current) {
      clearTimeout(saveSettingsTimeoutRef.current);
    }
    
    saveSettingsTimeoutRef.current = setTimeout(async () => {
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
        console.error('❌ Ошибка сохранения настроек:', error);
      }
    }, 3000);
    
    return () => {
      if (saveSettingsTimeoutRef.current) {
        clearTimeout(saveSettingsTimeoutRef.current);
      }
    };
  }, [
    selectedCity, selectedGender, selectedPosition, selectedMood,
    currentSelectedStation, selectedMinutes, nickname, clothingColor,
    wagonNumber, currentScreen, currentGroup, isColdStart
  ]);

  // Оптимизированный useEffect для обновления статуса
  useEffect(() => {
    if (updateStatusTimeoutRef.current) {
      clearTimeout(updateStatusTimeoutRef.current);
    }
    
    if (userIdRef.current && (selectedPosition || selectedMood)) {
      updateStatusTimeoutRef.current = setTimeout(() => {
        debouncedUpdateUserState();
      }, 5000);
    }
    
    return () => {
      if (updateStatusTimeoutRef.current) {
        clearTimeout(updateStatusTimeoutRef.current);
      }
    };
  }, [selectedPosition, selectedMood, debouncedUpdateUserState]);

  // Оптимизированный useEffect для обработки онлайн/оффлайн
  useEffect(() => {
    const handleOnline = async () => {
      console.log('🌐 Интернет восстановлен');
      setIsOnline(true);
      
      if (userIdRef.current && (currentScreen === 'joined' || currentScreen === 'waiting')) {
        try {
          const currentDeviceId = await generateDeviceId();
          await setUserOnline(userIdRef.current, sessionIdRef.current, currentDeviceId);
          
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
  }, [currentScreen, currentGroup, loadStationsMap, loadRequests, loadGroupMembers]);

  // Оптимизированная инициализация
  useEffect(() => {
    console.log('✅ React компонент App загружен');
    
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
    
    bridge.send("VKWebAppInit")
      .then((data) => {
        if (data.result) {
          console.log('✅ VK Bridge инициализирован');
        }
      })
      .catch((error) => {
        console.error('❌ Ошибка инициализации VK Bridge:', error);
      });

    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('📱 Приложение ушло в фон');
        isInBackgroundRef.current = true;
        setAppState('background');
      } else {
        console.log('📱 Приложение активно');
        isInBackgroundRef.current = false;
        setAppState('active');
        if (userIdRef.current) {
          improvedPingActivity();
        }
      }
    };

    const handleBeforeUnload = async (event) => {
      console.log('⚠️ Приложение закрывается - устанавливаем оффлайн');
      isAppClosingRef.current = true;
      
      if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
      if (backgroundPingIntervalRef.current) clearInterval(backgroundPingIntervalRef.current);
      
      if (userIdRef.current) {
        try {
          const currentDeviceId = await generateDeviceId();
          await setUserOffline(userIdRef.current, sessionIdRef.current, currentDeviceId);
        } catch (error) {
          console.error('❌ Ошибка при установке оффлайн:', error);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    const bridgeUnsubscribe = bridge.subscribe((event) => {
      if (!event.detail) return;
      
      const { type, data } = event.detail;
      
      switch (type) {
        case 'VKWebAppUpdateConfig':
          const schemeAttribute = document.createAttribute('scheme');
          schemeAttribute.value = data.scheme ? data.scheme : 'client_light';
          document.body.attributes.setNamedItem(schemeAttribute);
          break;
        case 'VKWebAppViewHide':
          isInBackgroundRef.current = true;
          setAppState('background');
          break;
        case 'VKWebAppViewRestore':
          isInBackgroundRef.current = false;
          setAppState('active');
          if (userIdRef.current) improvedPingActivity();
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
    
    const restoreSession = async () => {
      if (sessionRestoreInProgressRef.current) return;
      sessionRestoreInProgressRef.current = true;
      setIsSessionRestoring(true);
      setRestoreAttempted(true);
      
      try {
        console.log('🔄 Начинаем восстановление сессии...');
        const savedState = await loadSessionState();
        
        if (savedState) {
          console.log('📂 Используем сохраненное состояние сессии');
          
          setNickname(savedState.nickname || '');
          setSelectedCity(savedState.selectedCity || 'spb');
          setSelectedGender(savedState.selectedGender || 'male');
          setClothingColor(savedState.clothingColor || '');
          setWagonNumber(savedState.wagonNumber || '');
          setCurrentSelectedStation(savedState.currentSelectedStation || null);
          
          const currentDeviceId = await generateDeviceId();
          const users = await safeApiCall(api.getUsers);
          
          let serverSession = null;
          if (savedState.userId) {
            serverSession = users.find(user => user.id === savedState.userId);
          }
          
          if (!serverSession && savedState.nickname) {
            serverSession = users.find(user => 
              user.device_id === currentDeviceId && 
              user.name === savedState.nickname &&
              user.online === true
            );
          }
          
          if (!serverSession) {
            serverSession = users.find(user => 
              user.device_id === currentDeviceId &&
              user.online === true
            );
          }
          
          if (serverSession) {
            userIdRef.current = serverSession.id;
            const newSessionId = generateSessionId(currentDeviceId);
            sessionIdRef.current = newSessionId;
            
            await setUserOnline(serverSession.id, newSessionId, currentDeviceId);
            
            setSelectedPosition(serverSession.position || '');
            setSelectedMood(serverSession.mood || '');
            
            if (serverSession.is_connected && serverSession.station) {
              setCurrentScreen('joined');
              setCurrentGroup({ station: serverSession.station, users: [] });
              
              setTimeout(() => {
                loadGroupMembers(serverSession.station);
                loadRequests();
              }, 300);
              
            } else if (serverSession.is_waiting || !serverSession.is_connected) {
              setCurrentScreen('waiting');
              loadStationsMap();
              loadRequests();
            } else {
              setCurrentScreen('setup');
            }
            
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
            console.log('❌ Сессия не найдена на сервере, начинаем заново');
            setCurrentScreen('setup');
            await clearSessionState();
          }
        } else {
          console.log('🆕 Нет сохраненного состояния, начинаем с сервера');
          await checkAndRestoreSession();
        }
      } catch (error) {
        console.error('❌ Критическая ошибка восстановления сессии:', error);
        setCurrentScreen('setup');
      } finally {
        setIsSessionRestoring(false);
        sessionRestoreInProgressRef.current = false;
        setIsColdStart(false);
      }
    };
    
    const checkAndRestoreSession = async () => {
      try {
        const currentDeviceId = await generateDeviceId();
        console.log('🔍 Ищем активные сессии для устройства:', currentDeviceId);
        
        const users = await safeApiCall(api.getUsers);
        const deviceSessions = users.filter(user => 
          user.device_id === currentDeviceId &&
          user.online === true
        );
        
        console.log(`📊 Найдено активных сессий:`, deviceSessions.length);
        
        if (deviceSessions.length === 0) {
          console.log('🆕 Нет активных сессий для этого устройства');
          setCurrentScreen('setup');
          return;
        }
        
        deviceSessions.sort((a, b) => {
          const timeA = a.last_seen ? new Date(a.last_seen).getTime() : 0;
          const timeB = b.last_seen ? new Date(b.last_seen).getTime() : 0;
          return timeB - timeA;
        });
        
        const latestSession = deviceSessions[0];
        console.log('🎯 Самая свежая сессия:', latestSession.id, latestSession.name);
        
        userIdRef.current = latestSession.id;
        const newSessionId = generateSessionId(currentDeviceId);
        sessionIdRef.current = newSessionId;
        
        setNickname(latestSession.name || '');
        setSelectedCity(latestSession.city || 'spb');
        setSelectedGender(latestSession.gender || 'male');
        setSelectedPosition(latestSession.position || '');
        setSelectedMood(latestSession.mood || '');
        setClothingColor(latestSession.color || '');
        setWagonNumber(latestSession.wagon || '');
        
        await setUserOnline(latestSession.id, newSessionId, currentDeviceId);
        
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
        
        if (latestSession.is_connected && latestSession.station) {
          setCurrentSelectedStation(latestSession.station);
          setCurrentScreen('joined');
          setCurrentGroup({ station: latestSession.station, users: [] });
          setTimeout(() => {
            loadGroupMembers(latestSession.station);
            loadRequests();
          }, 100);
        } else {
          setCurrentScreen('waiting');
          loadStationsMap();
          loadRequests();
        }
        
      } catch (error) {
        console.error('❌ Ошибка проверки сессии:', error);
        setCurrentScreen('setup');
      }
    };
    
    restoreSession();
    
    const startPeriodicPing = () => {
      return setInterval(async () => {
        if (userIdRef.current && !isInBackgroundRef.current) {
          await improvedPingActivity();
        }
      }, PING_INTERVAL);
    };

    const pingInterval = startPeriodicPing();

    return () => {
      console.log('🧹 Очистка компонента');
      
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      if (bridgeUnsubscribe) bridgeUnsubscribe();
      
      if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
      if (pingInterval) clearInterval(pingInterval);
      if (backgroundPingIntervalRef.current) clearInterval(backgroundPingIntervalRef.current);
      if (globalRefreshIntervalRef.current) clearInterval(globalRefreshIntervalRef.current);
      if (saveSettingsTimeoutRef.current) clearTimeout(saveSettingsTimeoutRef.current);
      if (updateStatusTimeoutRef.current) clearTimeout(updateStatusTimeoutRef.current);
      
      if (isAppClosingRef.current && userIdRef.current) {
        const currentDeviceId = deviceId || 'device_' + Math.random().toString(36).substr(2, 9);
        setUserOffline(userIdRef.current, sessionIdRef.current, currentDeviceId);
      }
    };
  }, []);

  // Рендер приложения
  return (
    <div className="app-container">
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