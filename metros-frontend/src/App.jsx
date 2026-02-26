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

// Кэш VKStorage в памяти
let storageCache = {};

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
    
    // Обновляем кэш
    storageCache = { ...storageCache, ...data };
    return data;
  } catch (error) {
    // Fallback на localStorage
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

// Быстрое сохранение в VKStorage
const saveToVKStorage = async (key, value) => {
  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    await bridge.send('VKWebAppStorageSet', { key, value: stringValue });
    storageCache[key] = value;
  } catch (error) {
    // Fallback на localStorage
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

// Генерация deviceId (синхронно для скорости)
const generateDeviceId = () => {
  let deviceId = storageCache[STORAGE_KEYS.DEVICE_ID] || localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  
  if (!deviceId) {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 10);
    deviceId = `metro_${timestamp}_${randomStr}`;
    // Сохраним асинхронно позже
    setTimeout(() => saveToVKStorage(STORAGE_KEYS.DEVICE_ID, deviceId), 100);
  }
  
  return deviceId;
};

// Генерация сессии
const generateSessionId = (deviceId) => {
  return `s_${deviceId}_${Date.now()}`;
};

// Быстрый поиск пользователя по deviceId
const findUserByDeviceId = (users, deviceId) => {
  for (let i = 0; i < users.length; i++) {
    if (users[i].device_id === deviceId && users[i].online === true) {
      return users[i];
    }
  }
  return null;
};

// Вычисление статистики станций
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
  // Основные состояния с мгновенной загрузкой из кэша
  const [currentScreen, setCurrentScreen] = useState(() => {
    return storageCache[STORAGE_KEYS.CURRENT_SCREEN] || 
           localStorage.getItem(STORAGE_KEYS.CURRENT_SCREEN) || 
           'setup';
  });
  
  const [selectedCity, setSelectedCity] = useState(() => {
    return storageCache[STORAGE_KEYS.CITY] || 
           localStorage.getItem(STORAGE_KEYS.CITY) || 
           'spb';
  });
  
  const [selectedGender, setSelectedGender] = useState(() => {
    return storageCache[STORAGE_KEYS.GENDER] || 
           localStorage.getItem(STORAGE_KEYS.GENDER) || 
           'male';
  });
  
  const [selectedPosition, setSelectedPosition] = useState(() => {
    return storageCache[STORAGE_KEYS.POSITION] || 
           localStorage.getItem(STORAGE_KEYS.POSITION) || 
           '';
  });
  
  const [selectedMood, setSelectedMood] = useState(() => {
    return storageCache[STORAGE_KEYS.MOOD] || 
           localStorage.getItem(STORAGE_KEYS.MOOD) || 
           '';
  });
  
  const [wagonNumber, setWagonNumber] = useState(() => {
    return storageCache[STORAGE_KEYS.WAGON_NUMBER] || 
           localStorage.getItem(STORAGE_KEYS.WAGON_NUMBER) || 
           '';
  });
  
  const [clothingColor, setClothingColor] = useState(() => {
    return storageCache[STORAGE_KEYS.CLOTHING_COLOR] || 
           localStorage.getItem(STORAGE_KEYS.CLOTHING_COLOR) || 
           '';
  });
  
  const [nickname, setNickname] = useState(() => {
    return storageCache[STORAGE_KEYS.NICKNAME] || 
           localStorage.getItem(STORAGE_KEYS.NICKNAME) || 
           '';
  });
  
  const [currentSelectedStation, setCurrentSelectedStation] = useState(() => {
    return storageCache[STORAGE_KEYS.SELECTED_STATION] || 
           localStorage.getItem(STORAGE_KEYS.SELECTED_STATION) || 
           null;
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
  const [nicknameError, setNicknameError] = useState(false);
  const [clothingColorError, setClothingColorError] = useState(false);
  const [stationError, setStationError] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Refs
  const userIdRef = useRef(null);
  const sessionIdRef = useRef('');
  const vkUserIdRef = useRef(null);
  const statsCacheRef = useRef(null);
  const pendingUpdatesRef = useRef({});
  const updateTimeoutRef = useRef(null);
  const loadAttemptsRef = useRef(0);

  // ==================== БЫСТРАЯ ЗАГРУЗКА ИЗ VKSTORAGE ====================
  useEffect(() => {
    const initFromVKStorage = async () => {
      try {
        // Загружаем все ключи одним запросом
        const keys = Object.values(STORAGE_KEYS);
        const data = await loadFromVKStorage(keys);
        
        // Мгновенно применяем все загруженные значения
        if (data[STORAGE_KEYS.USER_ID]) {
          userIdRef.current = data[STORAGE_KEYS.USER_ID];
        }
        
        if (data[STORAGE_KEYS.SESSION_ID]) {
          sessionIdRef.current = data[STORAGE_KEYS.SESSION_ID];
        }
        
        // Устанавливаем состояния без ререндеров где возможно
        if (data[STORAGE_KEYS.NICKNAME] && data[STORAGE_KEYS.NICKNAME] !== nickname) {
          setNickname(data[STORAGE_KEYS.NICKNAME]);
        }
        
        if (data[STORAGE_KEYS.CITY] && data[STORAGE_KEYS.CITY] !== selectedCity) {
          setSelectedCity(data[STORAGE_KEYS.CITY]);
        }
        
        if (data[STORAGE_KEYS.GENDER] && data[STORAGE_KEYS.GENDER] !== selectedGender) {
          setSelectedGender(data[STORAGE_KEYS.GENDER]);
        }
        
        if (data[STORAGE_KEYS.CLOTHING_COLOR] && data[STORAGE_KEYS.CLOTHING_COLOR] !== clothingColor) {
          setClothingColor(data[STORAGE_KEYS.CLOTHING_COLOR]);
        }
        
        if (data[STORAGE_KEYS.WAGON_NUMBER] && data[STORAGE_KEYS.WAGON_NUMBER] !== wagonNumber) {
          setWagonNumber(data[STORAGE_KEYS.WAGON_NUMBER]);
        }
        
        if (data[STORAGE_KEYS.SELECTED_STATION] && data[STORAGE_KEYS.SELECTED_STATION] !== currentSelectedStation) {
          setCurrentSelectedStation(data[STORAGE_KEYS.SELECTED_STATION]);
        }
        
        if (data[STORAGE_KEYS.CURRENT_SCREEN] && data[STORAGE_KEYS.CURRENT_SCREEN] !== currentScreen) {
          setCurrentScreen(data[STORAGE_KEYS.CURRENT_SCREEN]);
        }
        
        if (data[STORAGE_KEYS.POSITION] && data[STORAGE_KEYS.POSITION] !== selectedPosition) {
          setSelectedPosition(data[STORAGE_KEYS.POSITION]);
        }
        
        if (data[STORAGE_KEYS.MOOD] && data[STORAGE_KEYS.MOOD] !== selectedMood) {
          setSelectedMood(data[STORAGE_KEYS.MOOD]);
        }
        
        // Если были на экране joined, восстанавливаем группу
        if (data[STORAGE_KEYS.CURRENT_SCREEN] === 'joined' && data[STORAGE_KEYS.SELECTED_STATION]) {
          setCurrentGroup({ station: data[STORAGE_KEYS.SELECTED_STATION], users: [] });
          // Фоново загружаем участников
          setTimeout(() => {
            loadGroupMembers(data[STORAGE_KEYS.SELECTED_STATION]);
          }, 200);
        }
        
        // Получаем информацию о пользователе VK
        try {
          const user = await bridge.send('VKWebAppGetUserInfo');
          vkUserIdRef.current = user.id;
        } catch (e) {
          // Игнорируем
        }
        
        // Быстрая загрузка статистики
        loadStationsMap();
        
      } catch (error) {
        console.warn('VKStorage init error:', error);
      } finally {
        setIsInitialized(true);
      }
    };
    
    // Генерируем deviceId синхронно
    const devId = generateDeviceId();
    setDeviceId(devId);
    
    // Инициализация VK Bridge
    bridge.send("VKWebAppInit");
    
    // Подписка на события VK
    bridge.subscribe((event) => {
      if (!event.detail) return;
      
      const { type, data } = event.detail;
      if (type === 'VKWebAppUpdateConfig') {
        const schemeAttribute = document.createAttribute('scheme');
        schemeAttribute.value = data.scheme ? data.scheme : 'client_light';
        document.body.attributes.setNamedItem(schemeAttribute);
      }
    });
    
    // Загружаем данные из VKStorage
    initFromVKStorage();
    
    // Обработчики онлайн/офлайн
    const handleOnline = () => {
      setIsOnline(true);
      if (userIdRef.current) {
        loadStationsMap(true);
      }
    };
    
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ==================== СОХРАНЕНИЕ ИЗМЕНЕНИЙ В VKSTORAGE (debounced) ====================
  useEffect(() => {
    if (!isInitialized) return;
    
    // Собираем все текущие значения
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
    
    if (currentSelectedStation) {
      updates[STORAGE_KEYS.SELECTED_STATION] = currentSelectedStation;
    }
    
    if (userIdRef.current) {
      updates[STORAGE_KEYS.USER_ID] = userIdRef.current;
    }
    
    if (sessionIdRef.current) {
      updates[STORAGE_KEYS.SESSION_ID] = sessionIdRef.current;
    }
    
    // Отменяем предыдущий таймаут
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }
    
    // Устанавливаем новый таймаут для сохранения
    updateTimeoutRef.current = setTimeout(() => {
      saveMultipleToStorage(updates);
    }, 300); // Сохраняем через 300мс после последнего изменения
    
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [
    nickname, selectedCity, selectedGender, clothingColor,
    wagonNumber, currentScreen, selectedPosition, selectedMood,
    deviceId, currentSelectedStation, isInitialized
  ]);

  // ==================== БЫСТРАЯ ЗАГРУЗКА СТАТИСТИКИ ====================
  const loadStationsMap = useCallback(async (force = false) => {
    // Используем кэш если данные свежие (менее 10 секунд)
    if (!force && statsCacheRef.current && (Date.now() - statsCacheRef.current.timestamp < 10000)) {
      setStationsData(statsCacheRef.current.data);
      return statsCacheRef.current.data;
    }
    
    try {
      const users = await api.getUsers();
      const stats = calculateStationsStats(users, selectedCity);
      
      // Сохраняем в кэш с временной меткой
      statsCacheRef.current = {
        data: stats,
        timestamp: Date.now()
      };
      
      setStationsData(stats);
      return stats;
    } catch (error) {
      console.warn('Load stats error:', error);
      if (statsCacheRef.current) {
        setStationsData(statsCacheRef.current.data);
        return statsCacheRef.current.data;
      }
      return null;
    }
  }, [selectedCity]);

  // ==================== ЗАГРУЗКА УЧАСТНИКОВ ГРУППЫ ====================
  const loadGroupMembers = useCallback(async (station = null) => {
    const targetStation = station || (currentGroup ? currentGroup.station : null);
    if (!targetStation) {
      setGroupMembers([]);
      return;
    }
    
    try {
      // Используем новый оптимизированный endpoint
      const users = await api.getStationUsers(targetStation);
      setGroupMembers(users);
    } catch (error) {
      console.warn('Load members error:', error);
      // Fallback на старый метод
      try {
        const allUsers = await api.getUsers();
        const groupUsers = [];
        
        for (let i = 0; i < allUsers.length; i++) {
          const user = allUsers[i];
          if (user.station === targetStation && 
              user.is_connected === true &&
              user.online === true) {
            groupUsers.push(user);
          }
        }
        
        setGroupMembers(groupUsers);
      } catch (e) {
        // Тихая ошибка
      }
    }
  }, [currentGroup]);

  // ==================== ВХОД В КОМНАТУ ОЖИДАНИЯ (МГНОВЕННЫЙ) ====================
  const handleEnterWaitingRoom = async () => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setNicknameError(true);
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Пожалуйста, введите ваш никнейм'
      });
      return;
    }
    
    // МГНОВЕННО переключаем экран (до завершения API запросов)
    setCurrentScreen('waiting');
    setIsLoading(true);
    
    try {
      // Параллельно выполняем запросы
      const [users, stats] = await Promise.all([
        api.getUsers(),
        api.getStationsStats(selectedCity)
      ]);
      
      // Обновляем статистику
      if (stats) {
        setStationsData(stats);
      }
      
      // Поиск по deviceId
      let existingUser = findUserByDeviceId(users, deviceId);
      
      const newSessionId = generateSessionId(deviceId);
      sessionIdRef.current = newSessionId;
      
      if (existingUser) {
        // Обновляем существующую сессию
        userIdRef.current = existingUser.id;
        
        // Фоновое обновление (не ждем)
        api.updateUser(existingUser.id, {
          name: trimmedNickname,
          city: selectedCity,
          gender: selectedGender,
          session_id: newSessionId,
          device_id: deviceId,
          vk_user_id: vkUserIdRef.current,
          online: true,
          is_waiting: true,
          is_connected: false,
          last_seen: new Date().toISOString(),
          status: 'В режиме ожидания'
        }).catch(() => {});
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
        }
      }
      
      // Сохраняем в storage
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

  // ==================== ПОДТВЕРЖДЕНИЕ ВЫБОРА СТАНЦИИ (МГНОВЕННЫЙ) ====================
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

    // МГНОВЕННО обновляем UI
    setCurrentGroup({
      station: currentSelectedStation,
      users: []
    });
    setCurrentScreen('joined');
    setIsLoading(true);
    
    try {
      // Параллельно обновляем пользователя и загружаем участников
      const [updateResult, members] = await Promise.all([
        api.updateUser(userIdRef.current, {
          station: currentSelectedStation,
          wagon: wagonNumber,
          color: clothingColor.trim(),
          name: nickname.trim(),
          is_waiting: false,
          is_connected: true,
          online: true,
          last_seen: new Date().toISOString(),
          status: `На станции: ${currentSelectedStation}`
        }),
        api.getStationUsers(currentSelectedStation)
      ]);
      
      setGroupMembers(members);
      
      // Сохраняем в storage
      saveMultipleToStorage({
        [STORAGE_KEYS.CURRENT_SCREEN]: 'joined',
        [STORAGE_KEYS.SELECTED_STATION]: currentSelectedStation,
        [STORAGE_KEYS.CLOTHING_COLOR]: clothingColor.trim(),
        [STORAGE_KEYS.WAGON_NUMBER]: wagonNumber
      });
      
      // Обновляем статистику в фоне
      setTimeout(() => {
        loadStationsMap(true);
      }, 300);
      
    } catch (error) {
      console.error('Join station error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // ==================== ВЫХОД ИЗ ГРУППЫ ====================
  const handleLeaveGroup = async () => {
    if (userIdRef.current) {
      // Фоновое обновление
      api.updateUser(userIdRef.current, { 
        is_waiting: true,
        is_connected: false,
        station: '',
        status: 'В режиме ожидания',
        last_seen: new Date().toISOString()
      }).catch(() => {});
    }
    
    // Мгновенное обновление UI
    setCurrentGroup(null);
    setCurrentScreen('waiting');
    setSelectedPosition('');
    setSelectedMood('');
    
    // Сохраняем в storage
    saveMultipleToStorage({
      [STORAGE_KEYS.CURRENT_SCREEN]: 'waiting',
      [STORAGE_KEYS.POSITION]: '',
      [STORAGE_KEYS.MOOD]: ''
    });
    
    bridge.send("VKWebAppShowSnackbar", {
      text: 'Вы вышли из комнаты станции'
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
    
    // Фоновое обновление на сервере
    try {
      await api.updateUser(userIdRef.current, { 
        status,
        position: selectedPosition,
        mood: selectedMood,
        last_seen: new Date().toISOString()
      });
    } catch (error) {
      // Тихая ошибка
    }
  }, [selectedPosition, selectedMood]);

  // Автоматическое обновление группы
  useEffect(() => {
    let interval;
    
    if (currentScreen === 'joined' && currentGroup) {
      loadGroupMembers(currentGroup.station);
      interval = setInterval(() => {
        loadGroupMembers(currentGroup.station);
      }, 15000); // Каждые 15 секунд
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentScreen, currentGroup, loadGroupMembers]);

  // Дебаунс обновления состояния
  useEffect(() => {
    const timer = setTimeout(() => {
      if (userIdRef.current && (selectedPosition || selectedMood)) {
        updateUserState();
      }
    }, 300);
    
    return () => clearTimeout(timer);
  }, [selectedPosition, selectedMood, updateUserState]);

  // Периодическое обновление статистики
  useEffect(() => {
    if (currentScreen === 'waiting' || currentScreen === 'joined') {
      const interval = setInterval(() => {
        loadStationsMap();
      }, 20000); // Каждые 20 секунд
      
      return () => clearInterval(interval);
    }
  }, [currentScreen, loadStationsMap]);

  // ==================== РЕНДЕР КАРТЫ СТАНЦИЙ ====================
  const renderStationsMap = () => {
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
  };

  // ==================== РЕНДЕР УЧАСТНИКОВ ГРУППЫ ====================
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
  };

  // ==================== ОСНОВНОЙ РЕНДЕР ====================
  return (
    <div className="app-container">
      {!isOnline && (
        <div className="offline-indicator">
          ⚠️ Отсутствует соединение с интернетом
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
              <div className="subtitle">Встречай попутчика🚉✔</div>
            </div>
            <div className="header-icons">
              <div className="metro-icon">🚇</div>
            </div>
          </div>
        </header>
        
        <div className="content">
          {/* ЭКРАН НАСТРОЙКИ ПРОФИЛЯ */}
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
                disabled={isLoading}
              >
                {isLoading ? 'Создание профиля...' : 'Войти в комнату ожидания'}
              </button>
            </div>
          )}

          {/* ЭКРАН КОМНАТЫ ОЖИДАНИЯ */}
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

          {/* ЭКРАН ПРИСОЕДИНЕНИЯ К СТАНЦИИ */}
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