import { useState, useEffect, useRef } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';

// Ультра-быстрые функции
const generateDeviceId = async () => {
  try {
    const stored = await getVKStorageItem('deviceId');
    if (stored) return stored;
    const deviceId = 'd_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    await setVKStorageItem('deviceId', deviceId);
    return deviceId;
  } catch {
    return 'd_' + Math.random().toString(36).substr(2, 9);
  }
};

const generateSessionId = (deviceId) => `s_${deviceId}_${Date.now()}`;

const setVKStorageItem = async (key, value) => {
  try {
    await bridge.send('VKWebAppStorageSet', { key, value: String(value).substr(0, 4096) });
    return true;
  } catch {
    return false;
  }
};

const getVKStorageItem = async (key) => {
  try {
    const result = await bridge.send('VKWebAppStorageGet', { keys: [key] });
    return result?.keys?.[0]?.value || null;
  } catch {
    return null;
  }
};

const saveSessionState = async (state) => {
  try {
    await setVKStorageItem('metro_session', JSON.stringify({ ...state, t: Date.now() }));
    return true;
  } catch {
    return false;
  }
};

const loadSessionState = async () => {
  try {
    const data = await getVKStorageItem('metro_session');
    if (data) {
      const parsed = JSON.parse(data);
      if (Date.now() - parsed.t < 1800000) return parsed; // 30 минут
    }
  } catch {}
  return null;
};

const setUserOnline = async (userId, sessionId, deviceId) => {
  if (!userId) return;
  try {
    await api.updateUser(userId, { 
      online: true,
      last_seen: new Date().toISOString(),
      session_id: sessionId,
      device_id: deviceId
    });
  } catch {}
};

const setUserOffline = async (userId, sessionId, deviceId) => {
  if (!userId) return;
  try {
    await api.updateUser(userId, { 
      online: false,
      last_seen: new Date().toISOString(),
      session_id: sessionId,
      device_id: deviceId
    });
  } catch {}
};

const calculateStationsStats = (users, city) => {
  const stations = helpers.stations[city] || [];
  const stationStats = {};
  let total_connected = 0;
  let total_waiting = 0;

  // Инициализация
  for (let i = 0; i < stations.length; i++) {
    stationStats[stations[i]] = { station: stations[i], waiting: 0, connected: 0, totalUsers: 0 };
  }

  // Подсчет
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
    totalStats: { total_connected, total_waiting, total_users: total_connected + total_waiting }
  };
};

const showNotification = (text, type = 'info') => {
  console.log(`${type === 'error' ? '❌' : '✅'} ${text}`);
};

export const App = () => {
  // Состояния
  const [currentScreen, setCurrentScreen] = useState('setup');
  const [selectedCity, setSelectedCity] = useState('spb');
  const [selectedGender, setSelectedGender] = useState('male');
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

  // Рефы для максимальной скорости
  const userIdRef = useRef(null);
  const sessionIdRef = useRef('');
  const vkUserIdRef = useRef(null);
  const usersCacheRef = useRef(null);
  const cacheTimestampRef = useRef(0);
  const lastPingTimeRef = useRef(0);
  const lastApiCallRef = useRef(0);
  const updateIntervalRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const isInBackgroundRef = useRef(false);
  const isAppClosingRef = useRef(false);
  const apiQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);

  // Константы
  const CACHE_DURATION = 5000; // 5 секунд
  const PING_INTERVAL = 10000; // 10 секунд
  const UPDATE_INTERVAL = 5000; // 5 секунд

  // Ультра-быстрый API вызов с очередью
  const fastApiCall = async (apiFunction, ...args) => {
    const now = Date.now();
    
    // Минимальная задержка 50мс
    if (now - lastApiCallRef.current < 50) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    lastApiCallRef.current = Date.now();
    
    try {
      return await apiFunction(...args);
    } catch (error) {
      console.warn('API ошибка:', error.message);
      throw error;
    }
  };

  // Основная инициализация
  useEffect(() => {
    console.log('🚀 Запуск приложения с максимальной скоростью');
    
    // Инициализация устройства
    const initDevice = async () => {
      const id = await generateDeviceId();
      setDeviceId(id);
    };
    initDevice();
    
    // Инициализация VK Bridge
    bridge.send("VKWebAppInit");

    // Обработчики видимости
    const handleVisibilityChange = () => {
      isInBackgroundRef.current = document.hidden;
      if (!document.hidden && userIdRef.current) {
        fastPingActivity();
      }
    };

    const handleBeforeUnload = async () => {
      isAppClosingRef.current = true;
      if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      
      if (userIdRef.current) {
        const deviceId = await generateDeviceId();
        setUserOffline(userIdRef.current, sessionIdRef.current, deviceId);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Получение данных VK пользователя
    bridge.send('VKWebAppGetUserInfo')
      .then(user => vkUserIdRef.current = user?.id)
      .catch(() => {});

    // Быстрое восстановление сессии
    const fastRestoreSession = async () => {
      try {
        const saved = await loadSessionState();
        if (saved) {
          // Быстрое восстановление состояния
          if (saved.nickname) setNickname(saved.nickname);
          if (saved.selectedCity) setSelectedCity(saved.selectedCity);
          if (saved.selectedGender) setSelectedGender(saved.selectedGender);
          if (saved.clothingColor) setClothingColor(saved.clothingColor);
          if (saved.currentSelectedStation) setCurrentSelectedStation(saved.currentSelectedStation);

          const currentDeviceId = await generateDeviceId();
          
          try {
            const users = await fastApiCall(api.getUsers);
            let foundSession = null;
            
            // Поиск по нескольким параметрам
            if (saved.userId) {
              foundSession = users.find(u => u.id === saved.userId && u.online === true);
            }
            if (!foundSession && saved.nickname) {
              foundSession = users.find(u => 
                u.device_id === currentDeviceId && 
                u.name === saved.nickname &&
                u.online === true
              );
            }
            if (!foundSession) {
              foundSession = users.find(u => 
                u.device_id === currentDeviceId &&
                u.online === true
              );
            }
            
            if (foundSession) {
              userIdRef.current = foundSession.id;
              const newSessionId = generateSessionId(currentDeviceId);
              sessionIdRef.current = newSessionId;
              
              // Быстрый пинг для обновления статуса
              await fastApiCall(api.updateUser, foundSession.id, { 
                online: true,
                last_seen: new Date().toISOString(),
                session_id: newSessionId,
                device_id: currentDeviceId
              });
              
              // Установка экрана
              if (foundSession.is_connected && foundSession.station) {
                setCurrentScreen('joined');
                setCurrentGroup({ station: foundSession.station, users: [] });
                fastLoadGroupMembers(foundSession.station);
              } else {
                setCurrentScreen('waiting');
              }
              
              // Быстрая загрузка данных
              fastLoadStationsMap();
            } else {
              setCurrentScreen('setup');
            }
          } catch {
            setCurrentScreen('setup');
          }
        } else {
          setCurrentScreen('setup');
        }
      } catch {
        setCurrentScreen('setup');
      }
    };
    
    fastRestoreSession();

    // Запуск ультра-быстрых обновлений
    const startFastUpdates = () => {
      if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      
      // Обновление данных каждые 5 секунд
      updateIntervalRef.current = setInterval(() => {
        if (currentScreen === 'waiting') {
          fastLoadStationsMap();
        } else if (currentScreen === 'joined' && currentGroup) {
          fastLoadGroupMembers(currentGroup.station);
        }
      }, UPDATE_INTERVAL);
      
      // Пинг каждые 10 секунд
      pingIntervalRef.current = setInterval(() => {
        if (userIdRef.current && !isInBackgroundRef.current) {
          fastPingActivity();
        }
      }, PING_INTERVAL);
    };
    
    startFastUpdates();

    // Очистка
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      
      if (isAppClosingRef.current && userIdRef.current) {
        const deviceIdLocal = deviceId || 'd_' + Math.random().toString(36).substr(2, 9);
        setUserOffline(userIdRef.current, sessionIdRef.current, deviceIdLocal);
      }
    };
  }, [currentScreen, currentGroup]);

  // Ультра-быстрая загрузка карты станций
  const fastLoadStationsMap = async () => {
    try {
      const users = await fastApiCall(api.getUsers);
      const stats = calculateStationsStats(users, selectedCity);
      setStationsData(stats);
      
      const activeUsers = users.filter(user => user.online === true);
      usersCacheRef.current = activeUsers;
      cacheTimestampRef.current = Date.now();
    } catch {}
  };

  // Ультра-быстрая загрузка участников группы
  const fastLoadGroupMembers = async (station = null) => {
    const targetStation = station || (currentGroup ? currentGroup.station : null);
    if (!targetStation) return;
    
    try {
      const users = await fastApiCall(api.getUsers);
      const groupUsers = users.filter(user => 
        user.station === targetStation && 
        user.is_connected === true &&
        user.online === true
      );
      setGroupMembers(groupUsers);
    } catch {}
  };

  // Быстрая загрузка всех пользователей
  const fastLoadRequests = async (force = false) => {
    const now = Date.now();
    
    if (!force && usersCacheRef.current && (now - cacheTimestampRef.current) < CACHE_DURATION) {
      return usersCacheRef.current;
    }
    
    try {
      const users = await fastApiCall(api.getUsers);
      const activeUsers = users.filter(user => user.online === true);
      usersCacheRef.current = activeUsers;
      cacheTimestampRef.current = now;
      return activeUsers;
    } catch {
      return usersCacheRef.current || [];
    }
  };

  // Ультра-быстрый пинг
  const fastPingActivity = async () => {
    if (!userIdRef.current) return;
    
    const now = Date.now();
    if (now - lastPingTimeRef.current < 3000) return; // Не чаще 3 секунд
    
    try {
      const currentDeviceId = await generateDeviceId();
      
      await fastApiCall(api.pingActivity, userIdRef.current, { 
        online: true,
        is_connected: currentScreen === 'joined',
        session_id: sessionIdRef.current,
        device_id: currentDeviceId,
        last_seen: new Date().toISOString(),
        ...(currentScreen === 'joined' && currentGroup && { station: currentGroup.station })
      });
      
      lastPingTimeRef.current = now;
      
      if (currentScreen === 'joined') {
        fastLoadGroupMembers();
      }
    } catch {}
  };

  // Обработка сети
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      if (userIdRef.current) {
        const currentDeviceId = await generateDeviceId();
        await fastApiCall(api.updateUser, userIdRef.current, {
          online: true,
          last_seen: new Date().toISOString(),
          session_id: sessionIdRef.current,
          device_id: currentDeviceId
        });
        
        if (currentScreen === 'joined') {
          fastLoadGroupMembers();
          fastLoadRequests(true);
        } else if (currentScreen === 'waiting') {
          fastLoadStationsMap();
          fastLoadRequests();
        }
      }
    };
    
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [currentScreen, currentGroup]);

  // Быстрое сохранение настроек
  useEffect(() => {
    const saveSettings = async () => {
      try {
        const settings = {
          selectedCity,
          selectedGender,
          selectedPosition,
          selectedMood,
          selectedStation: currentSelectedStation,
          nickname,
          clothingColor,
          wagonNumber,
          currentScreen
        };
        
        // Быстрое сохранение
        Object.entries(settings).forEach(([key, value]) => {
          if (value != null) setVKStorageItem(key, String(value));
        });
        
        if (userIdRef.current) {
          await saveSessionState({
            userId: userIdRef.current,
            nickname,
            selectedCity,
            selectedGender,
            clothingColor,
            wagonNumber,
            currentSelectedStation,
            currentScreen,
            t: Date.now()
          });
        }
      } catch {}
    };
    
    const timeoutId = setTimeout(saveSettings, 300); // 300мс задержка
    
    return () => clearTimeout(timeoutId);
  }, [
    selectedCity, selectedGender, selectedPosition, selectedMood,
    currentSelectedStation, nickname, clothingColor,
    wagonNumber, currentScreen, currentGroup
  ]);

  // Мгновенное обновление статуса
  useEffect(() => {
    if (userIdRef.current && (selectedPosition || selectedMood)) {
      const timeoutId = setTimeout(() => {
        updateUserStatus();
      }, 300); // 300мс задержка
      
      return () => clearTimeout(timeoutId);
    }
  }, [selectedPosition, selectedMood]);

  // Мгновенное обновление статуса пользователя
  const updateUserStatus = async () => {
    if (!userIdRef.current) return;
    
    const status = selectedPosition && selectedMood 
      ? `${selectedPosition} | ${selectedMood}`
      : selectedPosition || selectedMood || 'Ожидание';
    
    try {
      const currentDeviceId = await generateDeviceId();
      
      await fastApiCall(api.updateUser, userIdRef.current, { 
        status,
        position: selectedPosition,
        mood: selectedMood,
        session_id: sessionIdRef.current,
        device_id: currentDeviceId,
        last_seen: new Date().toISOString()
      });
      
      // Мгновенное локальное обновление
      setGroupMembers(prev => prev.map(member => 
        member.id === userIdRef.current 
          ? { ...member, status, position: selectedPosition, mood: selectedMood }
          : member
      ));
      
    } catch {}
  };

  // Мгновенный вход в комнату ожидания
  const handleEnterWaitingRoom = async () => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setNicknameError(true);
      showNotification('Введите никнейм', 'error');
      return;
    }
    
    setIsLoading(true);
    
    try {
      const currentDeviceId = await generateDeviceId();
      const newSessionId = generateSessionId(currentDeviceId);
      
      const userData = {
        name: trimmedNickname,
        station: '',
        wagon: wagonNumber || '',
        color: clothingColor || '',
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
        device_id: currentDeviceId,
        vk_user_id: vkUserIdRef.current,
        last_seen: new Date().toISOString()
      };

      const createdUser = await fastApiCall(api.createUser, userData);
      
      if (createdUser) {
        userIdRef.current = createdUser.id;
        sessionIdRef.current = newSessionId;
        
        await saveSessionState({
          userId: userIdRef.current,
          nickname: trimmedNickname,
          selectedCity,
          selectedGender,
          clothingColor,
          wagonNumber,
          currentSelectedStation,
          currentScreen: 'waiting',
          t: Date.now()
        });
        
        setCurrentScreen('waiting');
        fastLoadStationsMap();
        showNotification('Профиль создан!', 'success');
      }
    } catch {
      showNotification('Ошибка создания', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Мгновенное присоединение к станции
  const handleConfirmStation = async () => {
    if (!clothingColor.trim()) {
      setClothingColorError(true);
      showNotification('Укажите цвет одежды', 'error');
      return;
    }
    
    if (!currentSelectedStation) {
      setStationError(true);
      showNotification('Выберите станцию', 'error');
      return;
    }

    setIsLoading(true);
    
    try {
      const currentDeviceId = await generateDeviceId();
      
      await fastApiCall(api.updateUser, userIdRef.current, {
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
        status: 'На станции: ' + currentSelectedStation
      });

      const users = await fastApiCall(api.getUsers);
      const stationUsers = users.filter(user => 
        user.station === currentSelectedStation && 
        user.is_connected === true &&
        user.online === true
      );
      
      setCurrentGroup({ station: currentSelectedStation, users: stationUsers });
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
        t: Date.now()
      });
      
      showNotification(`Вы на станции ${currentSelectedStation}`, 'success');
      fastLoadGroupMembers(currentSelectedStation);
      
    } catch {
      showNotification('Ошибка присоединения', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Мгновенный выход из группы
  const handleLeaveGroup = async () => {
    if (userIdRef.current) {
      try {
        const currentDeviceId = await generateDeviceId();
        
        await fastApiCall(api.updateUser, userIdRef.current, { 
          status: 'Ожидание',
          is_waiting: true,
          is_connected: false,
          station: '',
          session_id: sessionIdRef.current,
          device_id: currentDeviceId,
          last_seen: new Date().toISOString()
        });
        
        await saveSessionState({
          userId: userIdRef.current,
          nickname,
          selectedCity,
          selectedGender,
          clothingColor,
          wagonNumber,
          currentSelectedStation: null,
          currentScreen: 'waiting',
          t: Date.now()
        });
      } catch {}
    }
    
    setCurrentGroup(null);
    setCurrentScreen('waiting');
    setSelectedPosition('');
    setSelectedMood('');
    
    showNotification('Вы вышли со станции', 'info');
  };

  // Обработчики выбора
  const handleCitySelect = (city) => setSelectedCity(city);
  const handleGenderSelect = (gender) => setSelectedGender(gender);
  const handlePositionSelect = (position) => {
    setSelectedPosition(position);
    if (userIdRef.current) {
      setTimeout(updateUserStatus, 100);
    }
  };
  const handleMoodSelect = (mood) => {
    setSelectedMood(mood);
    if (userIdRef.current) {
      setTimeout(updateUserStatus, 100);
    }
  };
  const handleStationSelect = (stationName) => {
    setCurrentSelectedStation(stationName);
    if (stationError) setStationError(false);
  };

  // Сброс ошибок
  const handleNicknameChange = (e) => {
    setNickname(e.target.value);
    if (nicknameError) setNicknameError(false);
  };
  const handleClothingColorChange = (e) => {
    setClothingColor(e.target.value);
    if (clothingColorError) setClothingColorError(false);
  };

  // Навигация
  const showSetup = () => setCurrentScreen('setup');
  const showWaitingRoom = () => {
    if (!userIdRef.current) {
      showNotification('Создайте профиль сначала', 'info');
      return;
    }
    setCurrentScreen('waiting');
  };
  const showJoinedRoom = () => {
    if (!currentGroup) {
      showNotification('Выберите станцию сначала', 'info');
      return;
    }
    setCurrentScreen('joined');
  };

  // Быстрый рендер карты станций
  const renderStationsMap = () => {
    const { stationStats } = stationsData;
    
    if (stationStats.length === 0) {
      return <div className="loading">Загрузка карты...</div>;
    }
    
    const stationsMap = {};
    stationStats.forEach(station => {
      stationsMap[station.station] = station;
    });
    
    const cityStations = helpers.stations[selectedCity] || [];
    
    return cityStations.map(stationName => {
      const stationData = stationsMap[stationName];
      const waitingCount = stationData?.waiting || 0;
      const connectedCount = stationData?.connected || 0;
      const totalCount = waitingCount + connectedCount;
      const isSelected = currentSelectedStation === stationName;
      
      let stationClass = 'empty';
      if (connectedCount > 0) stationClass = 'connected';
      else if (waitingCount > 0) stationClass = 'waiting';
      
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

  // Быстрый рендер участников
  const renderGroupMembers = () => {
    if (groupMembers.length === 0) {
      return <div className="no-requests">Нет участников на станции</div>;
    }
    
    return groupMembers.map(user => {
      const isCurrentUser = userIdRef.current && user.id === userIdRef.current;
      
      let stateDetails = '';
      if (user.position) stateDetails += `<span class="state-highlight">${user.position}</span>`;
      if (user.mood) {
        if (user.position) stateDetails += ' • ';
        stateDetails += `<span class="state-highlight">${user.mood}</span>`;
      }
      
      let additionalInfo = '';
      if (user.color) additionalInfo += `🎨 ${user.color}`;
      if (user.wagon) additionalInfo += (additionalInfo ? ' • ' : '') + `🚇 Вагон ${user.wagon}`;
      
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

  // Отладочная информация
  const renderSessionInfo = () => {
    if (process.env.NODE_ENV === 'development') {
      return (
        <div className="session-info">
          📱 Device: {deviceId?.substr(0, 10)}... | 
          👤 User: {userIdRef.current?.substr(0, 10)}... | 
          🖥️ Screen: {currentScreen} |
          📊 Users: {stationsData.totalStats?.total_connected || 0}✅ {stationsData.totalStats?.total_waiting || 0}⏳
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
          ⚠️ Нет интернета (вы онлайн)
        </div>
      )}
      
      {isLoading && (
        <div className="loader-card">
          <div className="loader-box">
            <div className="loader-1">
              <div className="neuromorphic-circle"></div>
            </div>
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
                  {nicknameError && <span style={{ color: '#ff4444', marginLeft: '5px', fontSize: '12px' }}>(обязательно)</span>}
                </label>
                <input 
                  type="text" 
                  id="nickname-input" 
                  placeholder="Придумайте уникальное имя" 
                  value={nickname}
                  onChange={handleNicknameChange}
                  className={nicknameError ? 'error-input' : ''}
                  required 
                />
                <small className="field-hint" style={{ color: nicknameError ? '#ff4444' : '' }}>
                  {nicknameError ? '❌ Введите никнейм' : 'Имя будет видно другим'}
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
                disabled={isLoading}
              >
                {isLoading ? 'Создание...' : 'Войти в комнату ожидания'}
              </button>
              
              {nicknameError && (
                <div className="error-message">
                  ⚠️ Пожалуйста, укажите ваш никнейм
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
                    <span>На станциях: {stationsData.totalStats?.total_connected || 0}</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-color waiting"></div>
                    <span>В ожидании: {stationsData.totalStats?.total_waiting || 0}</span>
                  </div>
                </div>
                
                <div className="metro-map" id="metro-map">
                  {renderStationsMap()}
                </div>
                
                {stationError && (
                  <div className="error-message">
                    ⚠️ Пожалуйста, выберите станцию на карте
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
                    {clothingColorError && <span style={{ color: '#ff4444', marginLeft: '5px', fontSize: '12px' }}>(обязательно)</span>}
                  </label>
                  <input 
                    type="text" 
                    id="color-select" 
                    placeholder="Например: черный верх, синий низ, очки, шапка" 
                    value={clothingColor}
                    onChange={handleClothingColorChange}
                    required 
                  />
                  <small className="field-hint" style={{ color: clothingColorError ? '#ff4444' : '' }}>
                    {clothingColorError ? '❌ Это поле обязательно' : 'Обязательное поле'}
                  </small>
                </div>
                
                {(clothingColorError || stationError) && (
                  <div className="error-message">
                    {clothingColorError && stationError ? '⚠️ Заполните все поля и выберите станцию' :
                     clothingColorError ? '⚠️ Укажите цвет одежды' :
                     '⚠️ Выберите станцию'}
                  </div>
                )}
                           
                <button 
                  className="btn btn-success" 
                  onClick={handleConfirmStation}
                  disabled={isLoading}
                >
                  {isLoading ? 'Присоединение...' : 'Подтвердить и присоединиться'}
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
                  📍 Позиция: <span id="current-position">{selectedPosition || 'не выбрана'}</span>
                </div>
                <div className="status-indicator" id="mood-indicator">
                  😊 Настроение: <span id="current-mood">{selectedMood || 'не выбрано'}</span>
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
          &copy; 2025 | Метрос | Встречай попутчика в метро
        </footer>
      </div>
    </div>
  );
};