import { useState, useEffect, useRef } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers } from './services/api';
import { TimerComponent } from './TimerComponent';

// Генерация уникального ID устройства
const generateDeviceId = () => {
  let deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    localStorage.setItem('deviceId', deviceId);
  }
  return deviceId;
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
  const [stationsData, setStationsData] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [usersCache, setUsersCache] = useState(null);
  const [cacheTimestamp, setCacheTimestamp] = useState(0);
  const [lastPingTime, setLastPingTime] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [deviceId, setDeviceId] = useState('');
  const [isSessionRestoring, setIsSessionRestoring] = useState(false);
  const [nicknameError, setNicknameError] = useState(false); // НОВОЕ: состояние ошибки никнейма
  
  const CACHE_DURATION = 10000;
  const PING_INTERVAL = 15000;

  const userIdRef = useRef(null);
  const globalRefreshIntervalRef = useRef(null);
  const sessionIdRef = useRef('');
  const vkUserIdRef = useRef(null);
  const nicknameInputRef = useRef(null); // НОВОЕ: ссылка на поле ввода

  // Генерация уникального ID сессии
  const generateSessionId = () => {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  };

  // Основная инициализация приложения
  useEffect(() => {
    console.log('✅ React компонент App загружен');
    
    // Инициализация устройства
    const generatedDeviceId = generateDeviceId();
    setDeviceId(generatedDeviceId);
    
    // Генерация ID сессии
    const sessionId = generateSessionId();
    sessionIdRef.current = sessionId;
    
    console.log('📱 Идентификатор устройства:', generatedDeviceId);
    console.log('🔑 ID сессии:', sessionId);
    
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
          setAppState('background');
          break;
        case 'VKWebAppViewRestore':
          setAppState('active');
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
      setIsSessionRestoring(true);
      try {
        await checkAndRestoreSession(generatedDeviceId, sessionId);
      } catch (error) {
        console.error('❌ Ошибка восстановления сессии:', error);
        setCurrentScreen('setup');
      } finally {
        setIsSessionRestoring(false);
      }
    };
    
    restoreSession();
    
    // Запуск глобального обновления
    const cleanupGlobalRefresh = startGlobalRefresh();

    return () => {
      cleanupGlobalRefresh();
      
      if (globalRefreshIntervalRef.current) {
        clearInterval(globalRefreshIntervalRef.current);
      }
    };
  }, []);

  // Проверка и восстановление сессии
  const checkAndRestoreSession = async (deviceId, sessionId) => {
    try {
      const users = await api.getUsers();
      
      // Ищем активную сессию с этого устройства
      const activeSession = users.find(user => 
        user.device_id === deviceId && 
        (user.online === true || 
         (user.last_seen && Date.now() - new Date(user.last_seen).getTime() < 300000)) // 5 минут
      );
      
      if (activeSession) {
        console.log('🔄 Найдена активная сессия:', activeSession.id);
        
        userIdRef.current = activeSession.id;
        
        // Обновляем сессию
        await api.updateUser(activeSession.id, {
          session_id: sessionId,
          online: true,
          last_seen: new Date().toISOString(),
          device_id: deviceId
        });
        
        // Восстанавливаем состояние
        await restoreUserSession(activeSession);
        
        // Очищаем старые сессии с этого устройства
        await cleanupOldSessions(deviceId, sessionId);
      } else {
        // Нет активной сессии - начинаем с настройки
        console.log('🆕 Нет активной сессии, начинаем с настройки');
        setCurrentScreen('setup');
      }
    } catch (error) {
      console.error('❌ Ошибка проверки сессии:', error);
      setCurrentScreen('setup');
    }
  };

  // Восстановление сессии пользователя
  const restoreUserSession = async (userData) => {
    try {
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
        const groupData = {
          station: userData.station,
          users: []
        };
        
        setCurrentGroup(groupData);
        setCurrentSelectedStation(userData.station);
        
        // Загружаем данные станции
        await loadStationsMap();
        
        // Переходим в комнату станции
        setTimeout(() => {
          setCurrentScreen('joined');
          console.log('✅ Восстановлена сессия в комнате станции:', userData.station);
        }, 100);
        
        // Загружаем участников группы
        setTimeout(() => {
          loadGroupMembers();
          loadRequests(true);
        }, 500);
        
      } else if (userData.is_waiting) {
        // Пользователь был в режиме ожидания
        setCurrentScreen('waiting');
        
        // Загружаем данные
        await loadStationsMap();
        await loadRequests();
        
        console.log('✅ Восстановлена сессия в комнате ожидания');
      } else {
        // Непонятное состояние - показываем настройки
        setCurrentScreen('setup');
      }
    } catch (error) {
      console.error('❌ Ошибка восстановления сессии:', error);
      setCurrentScreen('setup');
    }
  };

  // Очистка старых сессий
  const cleanupOldSessions = async (deviceId, currentSessionId) => {
    try {
      const users = await api.getUsers();
      const now = Date.now();
      
      // Находим старые сессии с этого устройства
      const oldSessions = users.filter(user => 
        user.device_id === deviceId && 
        user.id !== userIdRef.current &&
        user.session_id !== currentSessionId
      );
      
      // Помечаем старые сессии как неактивные
      for (const session of oldSessions) {
        try {
          await api.updateUser(session.id, {
            online: false,
            is_connected: false,
            is_waiting: false
          });
          console.log('🧹 Деактивирована старая сессия:', session.id);
        } catch (error) {
          console.error('Ошибка деактивации сессии:', error);
        }
      }
    } catch (error) {
      console.error('❌ Ошибка очистки старых сессий:', error);
    }
  };

  // Запуск глобального обновления
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

  // Загрузка статистики станций
  const loadStationsMap = async () => {
    try {
      const data = await api.getStationsStats(selectedCity);
      setStationsData(data);
    } catch (error) {
      console.error('Ошибка загрузки карты станций:', error);
    }
  };

  // Загрузка участников группы
  const loadGroupMembers = async () => {
    if (!currentGroup || !currentGroup.station) {
      setGroupMembers([]);
      return;
    }
    
    try {
      const users = await api.getUsers();
      const groupUsers = users.filter(user => 
        user.station === currentGroup.station && 
        user.is_connected === true &&
        user.online === true
      );
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
      if (currentScreen === 'joined' && currentGroup) {
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
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [currentScreen, currentGroup, deviceId]);

  // Сохранение состояний в localStorage
  useEffect(() => {
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
    
    if (currentGroup) {
      localStorage.setItem('currentGroup', JSON.stringify(currentGroup));
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

  // НОВОЕ: Валидация никнейма
  const validateNickname = () => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setNicknameError(true);
      
      // Визуальное выделение поля
      if (nicknameInputRef.current) {
        nicknameInputRef.current.style.border = '2px solid #ff4444';
        nicknameInputRef.current.style.backgroundColor = '#fff5f5';
        nicknameInputRef.current.style.boxShadow = '0 0 0 1px #ff4444';
        
        // Фокусировка на поле
        nicknameInputRef.current.focus();
      }
      
      // Уведомление VK
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

  // НОВОЕ: Сброс ошибки при изменении никнейма
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

  // Вход в комнату ожидания с валидацией
  const handleEnterWaitingRoom = async () => {
    console.log('🚪 === НАЧАЛО handleEnterWaitingRoom ===');
    
    // Валидация никнейма
    if (!validateNickname()) {
      return;
    }
    
    setIsLoading(true);

    try {
      // Проверяем, нет ли уже активной сессии с этого устройства
      const users = await api.getUsers();
      const existingSession = users.find(user => 
        user.device_id === deviceId && 
        user.online === true
      );
      
      let createdUser;
      
      if (existingSession) {
        // Используем существующую сессию
        createdUser = await api.updateUser(existingSession.id, {
          name: nickname.trim(),
          city: selectedCity,
          gender: selectedGender,
          session_id: sessionIdRef.current,
          device_id: deviceId,
          vk_user_id: vkUserIdRef.current,
          online: true,
          is_waiting: true,
          is_connected: false,
          last_seen: new Date().toISOString()
        });
        userIdRef.current = existingSession.id;
        console.log('🔄 Используем существующую сессию:', existingSession.id);
      } else {
        // Создаем нового пользователя с привязкой к устройству
        const userData = {
          name: nickname.trim(),
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
          session_id: sessionIdRef.current,
          device_id: deviceId,
          vk_user_id: vkUserIdRef.current,
          last_seen: new Date().toISOString()
        };

        createdUser = await api.createUser(userData);
        
        if (createdUser) {
          userIdRef.current = createdUser.id;
          console.log('🆕 Создана новая сессия:', createdUser.id);
        }
      }
      
      if (createdUser) {
        setTimeout(() => {
          setCurrentScreen('waiting');
        }, 100);

        await loadStationsMap();
        await loadRequests();
        
        // Очищаем старые сессии
        await cleanupOldSessions(deviceId, sessionIdRef.current);
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

  // Подтверждение выбора станции
  const handleConfirmStation = async () => {
    // Проверка на заполнение обязательного поля
    if (!clothingColor || clothingColor.trim() === '') {
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Пожалуйста, укажите цвет верхней одежды или стиль'
      });
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
    if (!currentSelectedStation) {
      bridge.send("VKWebAppShowSnackbar", {
        text: '❌ Пожалуйста, выберите станцию на карте'
      });
      return;
    }

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
          online: true,
          session_id: sessionIdRef.current,
          device_id: deviceId,
          last_seen: new Date().toISOString(),
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

  const handleStationSelect = (stationName) => {
    setCurrentSelectedStation(stationName);
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
    const handleBeforeUnload = async () => {
      if (userIdRef.current) {
        // Отмечаем пользователя как оффлайн, но сохраняем привязку к устройству
        try {
          await api.updateUser(userIdRef.current, { 
            online: false,
            last_seen: new Date().toISOString(),
            session_id: sessionIdRef.current,
            device_id: deviceId
          });
        } catch (error) {
          // Игнорируем ошибки при закрытии страницы
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentScreen, currentGroup, deviceId]);

  // Навигация
  const showSetup = () => setCurrentScreen('setup');
  const showWaitingRoom = () => {
    if (!userIdRef.current) {
      // Проверяем никнейм перед переходом
      if (!validateNickname()) {
        return;
      }
      // Если никнейм валиден, но userId еще нет, показываем сообщение
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
          🖥️ Screen: {currentScreen}
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
                      await api.updateUser(userIdRef.current, {
                        ...data,
                        session_id: sessionIdRef.current,
                        device_id: deviceId,
                        last_seen: new Date().toISOString()
                      });
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
  );
};