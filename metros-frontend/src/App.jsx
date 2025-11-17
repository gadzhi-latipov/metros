// Сначала VKUI стили, потом мои
// import '@vkontakte/vkui/dist/vkui.css';
import { useState, useEffect, useRef } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';

import { api, helpers } from './services/api';


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
  
  const CACHE_DURATION = 10000; // 10 секунд
  const PING_INTERVAL = 15000; // 15 секунд

  const timerIntervalRef = useRef(null);
  const timerSecondsRef = useRef(0);
  const userIdRef = useRef(null);
  const globalRefreshIntervalRef = useRef(null);

  // Восстановление состояний из localStorage
  useEffect(() => {
    const savedPosition = localStorage.getItem('selectedPosition');
    const savedMood = localStorage.getItem('selectedMood');
    const savedStation = localStorage.getItem('selectedStation');
    const savedTimer = localStorage.getItem('selectedTimerMinutes');
    
    if (savedPosition) setSelectedPosition(savedPosition);
    if (savedMood) setSelectedMood(savedMood);
    if (savedStation) setCurrentSelectedStation(savedStation);
    if (savedTimer) setSelectedMinutes(parseInt(savedTimer));
  }, []);

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
    console.log('🚀 App запущен, инициализируем VK Bridge...');

    // Инициализация VK Bridge согласно документации - должно быть в начале
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
          console.log('📱 Приложение перешло в фоновый режим');
          setAppState('background');
          break;
        case 'VKWebAppViewRestore':
          console.log('📱 Приложение восстановлено из фонового режима');
          setAppState('active');
          break;
        case 'VKWebAppInitResult':
          console.log('✅ VKWebAppInit успешно выполнен');
          break;
        case 'VKWebAppInitFailed':
          console.error('❌ VKWebAppInit завершился ошибкой:', data);
          break;
        default:
          break;
      }
    });

    // Получение данных пользователя
    async function fetchUserData() {
      try {
        console.log('👤 Загружаем данные пользователя...');
        const user = await bridge.send('VKWebAppGetUserInfo');
        console.log('✅ Данные пользователя получены:', user);
        setUser(user);
      } catch (error) {
        console.error('❌ Ошибка загрузки пользователя:', error);
      }
    }
    
    fetchUserData();
    const cleanupGlobalRefresh = startGlobalRefresh();

    return () => {
      cleanupGlobalRefresh();
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (globalRefreshIntervalRef.current) {
        clearInterval(globalRefreshIntervalRef.current);
      }
      if (userIdRef.current) {
        api.deleteUser(userIdRef.current).catch(console.error);
      }
    };
  }, []);


  // Добавь этот useEffect после твоих существующих useEffect
useEffect(() => {
  console.log('🔄 currentScreen ИЗМЕНИЛСЯ:', currentScreen);
}, 
[currentScreen]);

  // Глобальное обновление 
  const startGlobalRefresh = () => {
    const interval = setInterval(async () => {
      try {
        console.log('🔄 Глобальное обновление данных...');
        
        // Стратегия обновления в зависимости от активного экрана
        if (currentScreen === 'waiting') {
          await loadStationsMap();
          await loadRequests();
          restoreSelectedStation();
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

  const stopGlobalRefresh = () => {
    if (globalRefreshIntervalRef.current) {
      clearInterval(globalRefreshIntervalRef.current);
      globalRefreshIntervalRef.current = null;
    }
  };

// Загрузка карты станций
const loadStationsMap = async () => {
  try {
    const data = await api.getStationsStats(selectedCity);
    setStationsData(data);
    
    console.log('📊 Статистика станций:', data);
    console.log('📊 stationStats:', data.stationStats);
    console.log('📊 totalStats:', data.totalStats);
  } catch (error) {
    console.error('Ошибка загрузки карты станций:', error);
  }
};

// Рендер карты станций
const renderStationsMap = () => {
  console.log('🔍 renderStationsMap вызван:', {
    stationsData,
    stationStats: stationsData.stationStats,
    selectedCity,
    allStations: helpers.stations[selectedCity]
  });
  
  if (!stationsData.stationStats) return <div className="loading">Загрузка карты станций...</div>;
  
  const allStations = helpers.stations[selectedCity];
  const stationsMap = {};
  
  // Создаем карту станций для быстрого доступа
  stationsData.stationStats.forEach(station => {
    stationsMap[station.station] = station;
  });
  
  console.log('🔍 stationsMap:', stationsMap);
  
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
    
    console.log(`🔍 Станция ${stationName}:`, {
      stationData,
      userCount,
      waitingCount,
      connectedCount,
      stationClass
    });
    
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

// Загрузка участников группы
const loadGroupMembers = async () => {
  if (!currentGroup || !currentGroup.station) {
    console.log('❌ loadGroupMembers: нет currentGroup или station');
    setGroupMembers([]);
    return;
  }
  
  try {
    console.log('🔍 loadGroupMembers: загрузка для станции', currentGroup.station);
    const users = await api.getUsers();
    console.log('🔍 Все пользователи:', users);
    
    const groupUsers = users.filter(user => 
      user.station === currentGroup.station && 
      user.is_connected === true
    );
    
    console.log('🔍 Отфильтрованные пользователи:', groupUsers);
    setGroupMembers(groupUsers);
    
  } catch (error) {
    console.error('Ошибка загрузки участников группы:', error);
    setGroupMembers([]);
  }
};

  // Загрузка всех запросов с кэшированием
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
// Автоматическая загрузка участников при изменении currentGroup или currentScreen
useEffect(() => {
  if (currentScreen === 'joined' && currentGroup) {
    console.log('🔄 Автозагрузка участников для joined экрана');
    loadGroupMembers();
    loadRequests(true);
  }
}, [currentScreen, currentGroup]);
  const handleEnterWaitingRoom = async () => {
   

// Тестовый запрос
try {
  const testResponse = await fetch(`${api.API_BASE}/health`);
  console.log('🏥 Health check статус:', testResponse.status);
} catch (error) {
  console.error('❌ Нет подключения к бэкенду:', error);
}
  console.log('🔍 Проверка переменных:');
console.log('- currentScreen переменная:', currentScreen);
console.log('- setCurrentScreen функция:', typeof setCurrentScreen);
  console.log('🚪 === НАЧАЛО handleEnterWaitingRoom ===');
  console.log('📍 Текущий экран:', currentScreen);
  console.log('📍 selectedCity:', selectedCity);
  console.log('📍 selectedGender:', selectedGender);
  
  setIsLoading(true);

  try {
    const randomName = helpers.getRandomName(selectedGender);
    console.log('📍 Сгенерировано имя:', randomName);
    
    const userData = {
      name: randomName,
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

    console.log('📍 Отправляем запрос к API...');
    const createdUser = await api.createUser(userData);
    console.log('📍 Ответ от API:', createdUser);
    
    if (createdUser) {
      userIdRef.current = createdUser.id;
      console.log('✅ Пользователь создан, ID:', createdUser.id);
      
      // ПРИНУДИТЕЛЬНЫЙ ПЕРЕХОД
  setTimeout(() => {
    console.log('🔄 Принудительный переход через setTimeout');
    setCurrentScreen('waiting');
  }, 100);
      
      // Принудительно обновляем сразу
      setTimeout(() => {
        console.log('📍 После setTimeout - currentScreen должен быть:', 'waiting');
      }, 0);

      console.log('📍 Загружаем дополнительные данные...');
      await loadStationsMap();
      await loadRequests();
      
      console.log('✅ ВСЕ ОПЕРАЦИИ ВЫПОЛНЕНЫ');
    } else {
      console.error('❌ createdUser is null или undefined');
    }
  } catch (error) {
    console.error('❌ ОШИБКА в handleEnterWaitingRoom:', error);
    console.error('❌ Stack:', error.stack);
  } finally {
    setIsLoading(false);
    console.log('🚪 === КОНЕЦ handleEnterWaitingRoom ===');
  }
};

  const restoreSelectedStation = () => {
    const savedStation = localStorage.getItem('selectedStation');
    if (savedStation) {
      setCurrentSelectedStation(savedStation);
    }
  };

  const updateStationTitle = (stationName) => {
    console.log('✅ Заголовок обновлен:', stationName);
  };

  const forceRefreshUserDisplay = () => {
    console.log('🔄 Принудительное обновление отображения пользователей');
    
    if (currentScreen === 'waiting') {
      loadStationsMap();
      loadRequests(true);
    } else if (currentScreen === 'joined') {
      loadGroupMembers();
      loadRequests(true);
    }
  };

  // Подтверждение выбора станции
  const handleConfirmStation = async () => {
  if (!clothingColor) {
    bridge.send("VKWebAppShowSnackbar", {
      text: 'Пожалуйста, укажите цвет верхней одежды'
    });
    return;
  }
  
  if (!currentSelectedStation) {
    bridge.send("VKWebAppShowSnackbar", {
      text: 'Пожалуйста, выберите станцию на карте'
    });
    return;
  }
  
  if (userIdRef.current) {
    setIsLoading(true);
    try {
      await api.updateUser(userIdRef.current, {
        station: currentSelectedStation,
        wagon: wagonNumber,
        color: clothingColor,
        is_waiting: false,
        is_connected: true,
        status: 'Выбрал станцию: ' + currentSelectedStation
      });

      const result = await api.joinStation({
        userId: userIdRef.current,
        station: currentSelectedStation
      });
      
      console.log('🔍 Результат joinStation:', result);

      // ИСПРАВЛЕННАЯ ПРОВЕРКА РЕЗУЛЬТАТА
      if (result && result.success) {
        updateStationTitle(currentSelectedStation);

        setCurrentGroup({
          station: currentSelectedStation,
          users: result.users || [] // ЗАЩИТА ОТ UNDEFINED
        });
        setCurrentScreen('joined');
        
        // Загружаем данные для комнаты станции
        setTimeout(() => {
          loadGroupMembers();
          loadRequests(true);
        }, 100);
      } else {
        throw new Error('Не удалось присоединиться к станции');
      }
      
    } catch (error) {
      console.error('Ошибка при обновлении параметров:', error);
      bridge.send("VKWebAppShowSnackbar", {
        text: 'Ошибка: ' + error.message
      });
    } finally {
      setIsLoading(false);
    }
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
        });
      } catch (error) {
        console.error('Ошибка при обновлении пользователя:', error);
      }
    }
    
    setCurrentGroup(null);
    setCurrentScreen('waiting');
    setSelectedPosition('');
    setSelectedMood('');
  };

  // Таймер функции
  const startTimer = () => {
    if (timerIntervalRef.current) {
      console.log('⏹️ Таймер уже запущен');
      return;
    }
    
    timerSecondsRef.current = selectedMinutes * 60;
    setTimerActive(true);
    
    timerIntervalRef.current = setInterval(async () => {
      timerSecondsRef.current--;
      
      if (timerSecondsRef.current <= 0) {
        stopTimer();
        bridge.send("VKWebAppShowSnackbar", {
          text: 'Время ожидания истекло!'
        });
      }
      
      // Обновляем оставшееся время на сервере каждые 30 секунд
      if (timerSecondsRef.current % 30 === 0 && userIdRef.current) {
        try {
          await api.updateUser(userIdRef.current, { 
            timer_seconds: timerSecondsRef.current
          });
        } catch (error) {
          console.error('Ошибка обновления таймера на сервере:', error);
        }
      }
    }, 1000);
    
    // Сохраняем таймер на сервере
    if (userIdRef.current) {
      const timerEnd = new Date(Date.now() + timerSecondsRef.current * 1000);
      api.updateUser(userIdRef.current, {
        timer_seconds: timerSecondsRef.current,
        timer_end: timerEnd.toISOString(),
        show_timer: true,
        status: generateUserStatus()
      }).then(() => {
        console.log('✅ Таймер сохранен на сервере');
        forceRefreshUserDisplay();
      }).catch(console.error);
    }
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    
    timerSecondsRef.current = 0;
    setTimerActive(false);
    
    // Убираем таймер на сервере
    if (userIdRef.current) {
      api.updateUser(userIdRef.current, {
        timer_seconds: 0,
        show_timer: false,
        status: generateUserStatus()
      }).then(() => {
        console.log('✅ Таймер остановлен на сервере');
        forceRefreshUserDisplay();
      }).catch(console.error);
    }
  };

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
  const handleCitySelect = (city) => {
    setSelectedCity(city);
  };

  const handleGenderSelect = (gender) => {
    setSelectedGender(gender);
  };

  const handlePositionSelect = (position) => {
  setSelectedPosition(position);
  localStorage.setItem('selectedPosition', position);
  
  // НЕМЕДЛЕННОЕ ОБНОВЛЕНИЕ
  updateUserState();
};

const handleMoodSelect = (mood) => {
  setSelectedMood(mood);
  localStorage.setItem('selectedMood', mood);
  
  // НЕМЕДЛЕННОЕ ОБНОВЛЕНИЕ
  updateUserState();
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
    
    // ОБНОВЛЯЕМ СЕРВЕР
    await api.updateUser(userIdRef.current, { 
      status: newStatus,
      position: selectedPosition,
      mood: selectedMood
    });
    
    // ОБНОВЛЯЕМ ЛОКАЛЬНОЕ СОСТОЯНИЕ СРАЗУ
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
    
    // ОБНОВЛЯЕМ ДАННЫЕ С СЕРВЕРА
    await loadGroupMembers();
    
  } catch (error) {
    console.error('❌ Ошибка обновления состояния:', error);
  }};

  const improvedPingActivity = async () => {
    if (!userIdRef.current) return false;
    
    const now = Date.now();
    if (now - lastPingTime < PING_INTERVAL) {
      return false; // Слишком рано для следующего ping
    }
    
    try {
      await api.pingActivity(userIdRef.current);
      setLastPingTime(now);
      console.log('✅ Активность обновлена');
      return true;
    } catch (error) {
      console.error('Ошибка пинга активности:', error);
      return false;
    }
  };

  // Функции переключения экранов
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

  // Рендер карты станций
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
        waitingCount = stationData.waiting;
        connectedCount = stationData.connected;
        
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

  // Рендер участников группы
  const renderGroupMembers = () => {
     console.log('🔍 renderGroupMembers вызван:', {
    groupMembers: groupMembers,
    groupMembersLength: groupMembers.length,
    currentGroup: currentGroup,
    userId: userIdRef.current
  });
    if (groupMembers.length === 0) {
      return <div className="no-requests">Нет участников на этой станции</div>;
    }
    
    return groupMembers.map(user => {
      const isCurrentUser = userIdRef.current && user.id === userIdRef.current;
      
      let stateDetails = '';
      if (user.position || user.mood) {
        if (user.position) {
          stateDetails += `<span class="state-highlight">${user.position}</span>`;
        }
        if (user.mood) {
          if (user.position) stateDetails += ' • ';
          stateDetails += `<span class="state-highlight">${user.mood}</span>`;
        }
      } else {
        stateDetails = 'Позиция не указана • Настроение не указано';
      }
      
      let additionalInfo = '';
      if (user.color) {
        additionalInfo += `🎨 ${user.color}`;
      }
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
        <div className="loading-overlay">
          <div className="loading-spinner">Загрузка...</div>
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
          {/* Экран выбора параметров */}
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

          {/* Экран комнаты ожидания */}
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
                
                <div className="form-group">
                  <label htmlFor="color-select">Цвет верхней одежды или стиль</label>
                  <input 
                    type="text" 
                    id="color-select" 
                    placeholder="Например:черный верх,синий низ,очки,шапка" 
                    value={clothingColor}
                    onChange={(e) => setClothingColor(e.target.value)}
                    required 
                  />
                </div>
                
                <div className="compact-timer" id="waiting-room-timer">
                  <div className="timer-header">
                    <div className="timer-title">⏰ Таймер ожидания</div>
                    <div className="timer-status">
                      {timerActive ? 'Активен' : 'Не активен'}
                    </div>
                  </div>
                  <div className="timer-expanded">
                    <p>Выберите время ожидания на станции</p>
                    <div className="timer-options">
                      <button 
                        type="button" 
                        className={`btn timer-option ${selectedMinutes === 5 ? 'active' : ''}`}
                        onClick={() => handleTimerSelect(5)}
                      >
                        5 минут
                      </button>
                      <button 
                        type="button" 
                        className={`btn timer-option ${selectedMinutes === 10 ? 'active' : ''}`}
                        onClick={() => handleTimerSelect(10)}
                      >
                        10 минут
                      </button>
                      <button 
                        type="button" 
                        className={`btn timer-option ${selectedMinutes === 15 ? 'active' : ''}`}
                        onClick={() => handleTimerSelect(15)}
                      >
                        15 минут
                      </button>
                    </div>
                    <div className="timer-display">
                      {timerActive ? `Таймер запущен: ${selectedMinutes} мин` : 'Не запущен'}
                    </div>
                    <div className="timer-controls">
                      <button 
                        type="button" 
                        className="btn btn-success" 
                        onClick={startTimer}
                        disabled={timerActive}
                      >
                        Запустить таймер
                      </button>
                      <button 
                        type="button" 
                        className="btn btn-secondary" 
                        onClick={stopTimer}
                        disabled={!timerActive}
                      >
                        Остановить
                      </button>
                    </div>
                  </div>
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

          {/* Экран после присоединения */}
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
          &copy; 2025 | Гаджи Латипов | Метрос | Санкт-Петербург |||||
        </footer>
      </div>
    </div>
  );
};