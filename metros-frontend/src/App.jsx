// Сначала VKUI стили, потом мои
// import '@vkontakte/vkui/dist/vkui.css';
import { useState, useEffect, useRef } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';
import { TimerComponent } from './TimerComponent';



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
  const [nickname, setNickname] = useState(''); // ← НОВОЕ: поле для никнейма
  const [timerActive, setTimerActive] = useState(false);
  const [selectedMinutes, setSelectedMinutes] = useState(5);
  const [currentSelectedStation, setCurrentSelectedStation] = useState(null);
  const [currentGroup, setCurrentGroup] = useState(null);
  const [stationsData, setStationsData] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [usersCache, setUsersCache] = useState(null);
  const [cacheTimestamp, setCacheTimestamp] = useState(0);
  const [lastPingTime, setLastPingTime] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  
  const CACHE_DURATION = 10000;
  const PING_INTERVAL = 15000;

  const userIdRef = useRef(null);
  const globalRefreshIntervalRef = useRef(null);

// Восстановление состояний из localStorage
useEffect(() => {
  const savedPosition = localStorage.getItem('selectedPosition');
  const savedMood = localStorage.getItem('selectedMood');
  const savedStation = localStorage.getItem('selectedStation');
  const savedTimer = localStorage.getItem('selectedTimerMinutes');
  const savedNickname = localStorage.getItem('nickname');
  const savedUserId = localStorage.getItem('userId');
  const savedScreen = localStorage.getItem('currentScreen');
  const savedGroup = localStorage.getItem('currentGroup');
  const savedClothingColor = localStorage.getItem('clothingColor');
  const savedWagonNumber = localStorage.getItem('wagonNumber');
  
  if (savedPosition) setSelectedPosition(savedPosition);
  if (savedMood) setSelectedMood(savedMood);
  if (savedStation) setCurrentSelectedStation(savedStation);
  if (savedTimer) setSelectedMinutes(parseInt(savedTimer));
  if (savedNickname) setNickname(savedNickname);
  if (savedClothingColor) setClothingColor(savedClothingColor);
  if (savedWagonNumber) setWagonNumber(savedWagonNumber);
  
  // Восстанавливаем состояние группы
  if (savedGroup) {
    try {
      const groupData = JSON.parse(savedGroup);
      setCurrentGroup(groupData);
    } catch (error) {
      console.error('Ошибка восстановления группы:', error);
    }
  }
  
  // Восстанавливаем userId если есть
  if (savedUserId) {
    userIdRef.current = savedUserId;
    
    // Если был в joined, восстанавливаем соединение
    if (savedScreen === 'joined' && savedGroup) {
      console.log('🔄 Восстановление сессии пользователя в комнате станции');
      
      // Устанавливаем экран joined
      setTimeout(() => {
        setCurrentScreen('joined');
        
        // Восстанавливаем подключение к станции
        setTimeout(async () => {
          try {
            await api.updateUser(savedUserId, { 
              is_waiting: false,
              is_connected: true,
              station: JSON.parse(savedGroup).station,
              online: true
            });
            console.log('✅ Сессия восстановлена');
            
            // Загружаем актуальные данные
            loadGroupMembers();
            loadRequests(true);
          } catch (error) {
            console.error('❌ Ошибка восстановления сессии:', error);
            // Если не удалось восстановить, переводим в ожидание
            setCurrentScreen('waiting');
            localStorage.setItem('currentScreen', 'waiting');
          }
        }, 500);
      }, 100);
    } else {
      // Иначе показываем waiting
      setCurrentScreen('waiting');
    }
  } else {
    // Если пользователь новый, показываем setup
    setCurrentScreen('setup');
  }
}, []);

// Сохраняем состояние при изменении экрана
useEffect(() => {
  localStorage.setItem('currentScreen', currentScreen);
}, [currentScreen]);

// Сохраняем состояние группы
useEffect(() => {
  if (currentGroup) {
    localStorage.setItem('currentGroup', JSON.stringify(currentGroup));
  } else {
    localStorage.removeItem('currentGroup');
  }
}, [currentGroup]);

// Сохраняем цвет одежды и вагон
useEffect(() => {
  localStorage.setItem('clothingColor', clothingColor);
}, [clothingColor]);

useEffect(() => {
  localStorage.setItem('wagonNumber', wagonNumber);
}, [wagonNumber]);

// Сохраняем никнейм
useEffect(() => {
  localStorage.setItem('nickname', nickname);
}, [nickname]);

// В App.jsx добавьте:
useEffect(() => {
  const realtimePollingInterval = setInterval(async () => {
    if (currentScreen === 'joined' && currentGroup) {
      try {
        // Загружаем актуальных участников
        const users = await api.getUsers();
        const freshGroupMembers = users.filter(user => 
          user.station === currentGroup.station && 
          user.is_connected === true
        );
        
        // Обновляем только если есть изменения
        setGroupMembers(prevMembers => {
          const prevIds = prevMembers.map(u => u.id).sort();
          const newIds = freshGroupMembers.map(u => u.id).sort();
          
          if (JSON.stringify(prevIds) !== JSON.stringify(newIds)) {
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
  }, 2000); // Опрос каждые 2 секунды
  
  return () => clearInterval(realtimePollingInterval);
}, [currentScreen, currentGroup]);
  // Обработка онлайн/офлайн статуса
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    console.log('✅ React компонент App загружен');
  console.log('✅ Текущий экран:', currentScreen);
    console.log('🚀 App запущен, инициализируем VK Bridge...');

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
          setAppState('background');
          break;
        case 'VKWebAppViewRestore':
          setAppState('active');
          break;
        default:
          break;
      }
    });

    async function fetchUserData() {
      try {
        const user = await bridge.send('VKWebAppGetUserInfo');
        setUser(user);
      } catch (error) {
        console.error('❌ Ошибка загрузки пользователя:', error);
      }
    }
    
    fetchUserData();
    const cleanupGlobalRefresh = startGlobalRefresh();

      return () => {
    cleanupGlobalRefresh();
    
    if (globalRefreshIntervalRef.current) {
      clearInterval(globalRefreshIntervalRef.current);
    }
    if (userIdRef.current) {
      api.deleteUser(userIdRef.current).catch(console.error);
    }
  };
}, []);



  useEffect(() => {
    console.log('🔄 currentScreen ИЗМЕНИЛСЯ:', currentScreen);
  }, [currentScreen]);

  const startGlobalRefresh = () => {
    const interval = setInterval(async () => {
      try {
        if (currentScreen === 'waiting') {
          await loadStationsMap();
          await loadRequests();
        } else if (currentScreen === 'joined') {
          await loadGroupMembers();
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

  const loadStationsMap = async () => {
    try {
      const data = await api.getStationsStats(selectedCity);
      setStationsData(data);
      console.log('📊 Статистика станций:', data);
    } catch (error) {
      console.error('Ошибка загрузки карты станций:', error);
    }
  };

  const loadGroupMembers = async () => {
    if (!currentGroup || !currentGroup.station) {
      setGroupMembers([]);
      return;
    }
    
    try {
      const users = await api.getUsers();
      const groupUsers = users.filter(user => 
        user.station === currentGroup.station && 
        user.is_connected === true
      );
      setGroupMembers(groupUsers);
    } catch (error) {
      console.error('Ошибка загрузки участников группы:', error);
      setGroupMembers([]);
    }
  };

  const loadRequests = async (forceRefresh = false) => {
    const now = Date.now();
    
    if (!forceRefresh && usersCache && (now - cacheTimestamp) < CACHE_DURATION) {
      setAllUsers(usersCache);
      return usersCache;
    }
    
    try {
      const users = await api.getUsers();
      setAllUsers(users);
      setUsersCache(users);
      setCacheTimestamp(now);
      return users;
    } catch (error) {
      console.error('Ошибка загрузки запросов:', error);
      return usersCache || [];
    }
  };

  useEffect(() => {
    if (currentScreen === 'joined' && currentGroup) {
      loadGroupMembers();
      loadRequests(true);
    }
  }, [currentScreen, currentGroup]);


  // Автоматическое обновление статуса при изменении позиции или настроения
useEffect(() => {
  if (userIdRef.current && (selectedPosition || selectedMood)) {
    const timeoutId = setTimeout(() => {
      updateUserState();
    }, 500); // Небольшая задержка чтобы избежать множественных запросов
    
    return () => clearTimeout(timeoutId);
  }
}, [selectedPosition, selectedMood]);


const handleEnterWaitingRoom = async () => {
  console.log('🚪 === НАЧАЛО handleEnterWaitingRoom ===');
  
  // Проверка обязательных полей
  if (!nickname || nickname.trim() === '') {
    bridge.send("VKWebAppShowSnackbar", {
      text: '❌ Пожалуйста, введите ваш никнейм'
    });
    
    // Визуальное выделение поля
    const nicknameInput = document.getElementById('nickname-input');
    if (nicknameInput) {
      nicknameInput.style.border = '2px solid #ff4444';
      nicknameInput.style.backgroundColor = '#fff5f5';
      
      setTimeout(() => {
        nicknameInput.style.border = '';
        nicknameInput.style.backgroundColor = '';
      }, 3000);
    }
    
    return;
  }
  
  setIsLoading(true);

  try {
    // Теперь используем введенный пользователем никнейм
    const userData = {
      name: nickname.trim(), // ← ИСПОЛЬЗУЕМ никнейм пользователя
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
      isWaiting: true,
      isConnected: false
    };

    const createdUser = await api.createUser(userData);
    
    if (createdUser) {
      userIdRef.current = createdUser.id;
      
      setTimeout(() => {
        setCurrentScreen('waiting');
      }, 100);

      await loadStationsMap();
      await loadRequests();
    }
  } catch (error) {
    console.error('❌ ОШИБКА в handleEnterWaitingRoom:', error);
  } finally {
    setIsLoading(false);
  }
};
  const handleConfirmStation = async () => {
  // Проверка на заполнение обязательного поля
  if (!clothingColor || clothingColor.trim() === '') {
    bridge.send("VKWebAppShowSnackbar", {
      text: '❌ Пожалуйста, укажите цвет верхней одежды или стиль'
    });
    
    // Добавляем визуальное выделение пустого поля
    const colorInput = document.getElementById('color-select');
    if (colorInput) {
      colorInput.style.border = '2px solid #ff4444';
      colorInput.style.backgroundColor = '#fff5f5';
      
      // Убираем выделение через 3 секунды
      setTimeout(() => {
        colorInput.style.border = '';
        colorInput.style.backgroundColor = '';
      }, 3000);
    }
    
    return;
  }
    // Проверка никнейма (дополнительная проверка)
  if (!nickname || nickname.trim() === '') {
    bridge.send("VKWebAppShowSnackbar", {
      text: '❌ Пожалуйста, введите ваш никнейм'
    });
    return;
  }
  // Проверка выбора станции
  if (!currentSelectedStation) {
    bridge.send("VKWebAppShowSnackbar", {
      text: '❌ Пожалуйста, выберите станцию на карте'
    });
    
    // Визуальное выделение карты станций
    const metroMap = document.getElementById('metro-map');
    if (metroMap) {
      metroMap.style.border = '2px solid #ff4444';
      setTimeout(() => {
        metroMap.style.border = '';
      }, 3000);
    }
    
    return;
  }

   // Если все проверки пройдены
  if (userIdRef.current) {
    setIsLoading(true);
    try {
      await api.updateUser(userIdRef.current, {
        station: currentSelectedStation,
        wagon: wagonNumber,
        color: clothingColor.trim(),
        name: nickname.trim(),
        is_waiting: false,
        is_connected: true,
        online: true, // ← Устанавливаем онлайн статус
        status: 'Выбрал станцию: ' + currentSelectedStation
      });

      const result = await api.joinStation({
        userId: userIdRef.current,
        station: currentSelectedStation
      });
      
      if (result && result.success) {
        const groupData = {
          station: currentSelectedStation,
          users: result.users || []
        };
        
        setCurrentGroup(groupData);
        setCurrentScreen('joined');
        
        // Сохраняем в localStorage
        localStorage.setItem('currentGroup', JSON.stringify(groupData));
        localStorage.setItem('currentScreen', 'joined');
        
        // Показываем успешное уведомление
        bridge.send("VKWebAppShowSnackbar", {
          text: `✅ Вы присоединились к станции ${currentSelectedStation}`
        });
        
        setTimeout(() => {
          loadGroupMembers();
          loadRequests(true);
        }, 100);
      }
    } catch (error) {
      console.error('Ошибка при обновлении параметров:', error);
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Ошибка: ' + error.message
      });
    } finally {
      setIsLoading(false);
    }
  }
};

const handleLeaveGroup = async () => {
  if (userIdRef.current) {
    try {
      await api.updateUser(userIdRef.current, { 
        status: 'Ожидание',
        is_waiting: true,
        is_connected: false,
        station: ''
      });
      console.log('✅ Пользователь вышел из группы');
    } catch (error) {
      console.error('Ошибка при обновлении пользователя:', error);
    }
  }
  
  setCurrentGroup(null);
  setCurrentScreen('waiting');
  setSelectedPosition('');
  setSelectedMood('');
  
  // Очищаем только данные группы, но сохраняем другие настройки
  localStorage.removeItem('currentGroup');
  localStorage.setItem('currentScreen', 'waiting');
  
  // Показываем уведомление
  bridge.send("VKWebAppShowSnackbar", {
    text: 'Вы вышли из комнаты станции'
  });
};
// Обработка онлайн/офлайн статуса с восстановлением
useEffect(() => {
  const handleOnline = async () => {
    console.log('🌐 Интернет восстановлен');
    setIsOnline(true);
    
    // Если был в joined, восстанавливаем сессию
    if (currentScreen === 'joined' && currentGroup && userIdRef.current) {
      try {
        await api.updateUser(userIdRef.current, {
          online: true,
          is_connected: true
        });
        console.log('✅ Сессия восстановлена после потери соединения');
        
        // Обновляем данные
        await loadGroupMembers();
        await loadRequests(true);
      } catch (error) {
        console.error('❌ Ошибка восстановления сессии:', error);
      }
    }
  };
  
  const handleOffline = async () => {
    console.log('🌐 Потеряно интернет-соединение');
    setIsOnline(false);
  };
  
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}, [currentScreen, currentGroup]);
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

  const handleCitySelect = (city) => setSelectedCity(city);
  const handleGenderSelect = (gender) => setSelectedGender(gender);


        // обновление индикаторов состояния
            const handlePositionSelect = (position) => {
            const previousPosition = selectedPosition;
            setSelectedPosition(position);
            localStorage.setItem('selectedPosition', position);
            
            // Если позиция изменилась, обновляем статус
            if (previousPosition !== position) {
              updateUserState();
            }
          };

          const handleMoodSelect = (mood) => {
            const previousMood = selectedMood;
            setSelectedMood(mood);
            localStorage.setItem('selectedMood', mood);
            
            // Если настроение изменилось, обновляем статус
            if (previousMood !== mood) {
              updateUserState();
            }
          };

  const handleStationSelect = (stationName) => {
    setCurrentSelectedStation(stationName);
    localStorage.setItem('selectedStation', stationName);
  };

  const handleTimerSelect = (minutes) => {
    setSelectedMinutes(minutes);
    localStorage.setItem('selectedTimerMinutes', minutes);
  };

  const updateUserState = async () => {
    if (!userIdRef.current) return;
    
    try {
      const newStatus = generateUserStatus();
      await api.updateUser(userIdRef.current, { 
        status: newStatus,
        position: selectedPosition,
        mood: selectedMood
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

 const improvedPingActivity = async () => {
  if (!userIdRef.current) return false;
  
  const now = Date.now();
  if (now - lastPingTime < PING_INTERVAL) return false;
  
  try {
    // Обновляем онлайн статус с учетом текущего экрана
    const updateData = { 
      online: true,
      is_connected: currentScreen === 'joined',
      // Если пользователь в joined, сохраняем станцию
      ...(currentScreen === 'joined' && currentGroup && { 
        station: currentGroup.station 
      })
    };
    
    await api.pingActivity(userIdRef.current, updateData);
    setLastPingTime(now);
    
    // Обновляем данные если в joined
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
    if (userIdRef.current) {
      // Если пользователь был в joined, НЕ выходим из комнаты
      if (currentScreen === 'joined' && currentGroup) {
        console.log('🔄 Сохранение сессии при закрытии страницы');
        
        // Пытаемся отправить последнее обновление статуса
        try {
          await api.updateUser(userIdRef.current, { 
            online: false, // Устанавливаем offline
            last_seen: new Date().toISOString()
          });
        } catch (error) {
          // Игнорируем ошибки при закрытии страницы
        }
      } else {
        // Если не в joined, выходим полностью
        try {
          await api.updateUser(userIdRef.current, { 
            is_waiting: false,
            is_connected: false,
            station: '',
            online: false
          });
        } catch (error) {
          // Игнорируем ошибки при закрытии страницы
        }
      }
    }
  };

  window.addEventListener('beforeunload', handleBeforeUnload);
  
  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  };
}, [currentScreen, currentGroup]);

{isLoading && currentScreen === 'joined' && (
  <div className="restoring-session">
    <div className="restoring-spinner"></div>
    <div>Восстановление сессии...</div>
  </div>
)}

// индикатор восстановления сессии
  const showSetup = () => setCurrentScreen('setup');
  const showWaitingRoom = () => {
    if (!userIdRef.current) {
      bridge.send("VKWebAppShowSnackbar", {
        text: 'Сначала создайте профиль'
      });
      return showSetup();
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

  const renderStationsMap = () => {
    if (!stationsData.stationStats) return <div className="loading">Загрузка карты станций...</div>;
    
    const allStations = helpers.stations[selectedCity];
    const stationsMap = {};
    
    stationsData.stationStats.forEach(station => {
      stationsMap[station.station] = station;
    });
    
    return allStations.map(stationName => {
      const stationData = stationsMap[stationName];
      let userCount = 0;
      let waitingCount = 0;
      let connectedCount = 0;
      let stationClass = 'empty';
      
      if (stationData) {
        userCount = stationData.totalUsers || 0;
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
          onClick={() => handleStationSelect(stationName)}
        >
          <div className="station-name">{stationName}</div>
          {userCount > 0 ? (
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
          {user.show_timer && user.timer_seconds > 0 && (
            <div className="user-timer-display">
              <div className="timer-label">⏰ Осталось:</div>
              <div className="timer-value">{helpers.formatTime(user.timer_seconds)}</div>
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="app-container">
      {!isOnline && (
        <div className="offline-indicator">
          ⚠️ Отсутствует соединение с интернетом
        </div>
      )}
      {isLoading && (
        // <!-- 1. Нейроморфный лоадер -->
        <div class="loader-card">
            <h3 class="loader-title"></h3>
            <div class="loader-box">
                <div class="loader-1" id="neuromorphic-loader">
                    <div class="neuromorphic-circle"></div>
                </div>
            </div>
        </div>
      )}
      
      <p className="disclaimer">Сайт использует вымышленные имена пользователей</p>
      
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
              {/* ДОБАВЛЯЕМ ПОЛЕ НИКНЕЙМА */}
    <div className="form-group">
      <label htmlFor="nickname-input">Укажите Ваш никнейм *</label>
      <input 
        type="text" 
        id="nickname-input" 
        placeholder="Придумайте уникальное имя" 
        value={nickname}
        onChange={(e) => {
          setNickname(e.target.value);
          localStorage.setItem('nickname', e.target.value);
        }}
        required 
      />
      <small className="field-hint">
        Это имя будет видно другим участникам
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
                
                <div className="metro-map" id="metro-map">
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
                {/* Колонка ввода цвета верхней одежды */}
                <div className="form-group">
  <label htmlFor="color-select">Цвет верхней одежды или стиль *</label>
  <input 
    type="text" 
    id="color-select" 
    placeholder="Например: черный верх, синий низ, очки, шапка" 
    value={clothingColor}
    onChange={(e) => setClothingColor(e.target.value)}
    required 
  />
  <small className="field-hint">Это поле обязательно для заполнения</small>
</div>

                
             
                     <TimerComponent 
                            selectedMinutes={selectedMinutes}
                          onTimerSelect={handleTimerSelect}
                          userId={userIdRef.current}
                          onStatusUpdate={async (data) => {
                            if (userIdRef.current) {
                              await api.updateUser(userIdRef.current, data);
                            }
                          }}
                  
                     />
                           
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
          &copy; 2025 | Гаджи Латипов | Метрос | Санкт-Петербург
        </footer>
      </div>
    </div>
  );}
