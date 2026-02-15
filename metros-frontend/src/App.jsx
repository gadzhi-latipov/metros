import { useState, useEffect, useRef, useCallback } from 'react';
import bridge from '@vkontakte/vk-bridge';
import './App.css';
import { api, helpers, storage } from './services/api';

// Быстрое получение deviceId
const getDeviceId = () => {
  let deviceId = localStorage.getItem('metro_device_id');
  if (!deviceId) {
    deviceId = `metro_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    localStorage.setItem('metro_device_id', deviceId);
  }
  return deviceId;
};

// Кэш данных
const dataCache = {
  users: null,
  stats: null,
  lastUpdate: 0
};

// Быстрый парсинг JSON с обработкой ошибок
const safeJSONParse = (str, fallback = null) => {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch {
    return fallback;
  }
};

export const App = () => {
  // Основные состояния с быстрой загрузкой из localStorage
  const [currentScreen, setCurrentScreen] = useState(() => 
    localStorage.getItem('screen') || 'setup'
  );
  const [selectedCity, setSelectedCity] = useState(() => 
    localStorage.getItem('city') || 'spb'
  );
  const [selectedGender, setSelectedGender] = useState(() => 
    localStorage.getItem('gender') || 'male'
  );
  const [selectedPosition, setSelectedPosition] = useState(() => 
    localStorage.getItem('position') || ''
  );
  const [selectedMood, setSelectedMood] = useState(() => 
    localStorage.getItem('mood') || ''
  );
  const [wagonNumber, setWagonNumber] = useState(() => 
    localStorage.getItem('wagon') || ''
  );
  const [clothingColor, setClothingColor] = useState(() => 
    localStorage.getItem('color') || ''
  );
  const [nickname, setNickname] = useState(() => 
    localStorage.getItem('name') || ''
  );
  const [currentSelectedStation, setCurrentSelectedStation] = useState(() => 
    localStorage.getItem('station') || null
  );
  const [stationsData, setStationsData] = useState({ 
    stationStats: [], 
    totalStats: { total_connected: 0, total_waiting: 0, total_users: 0 } 
  });
  const [groupMembers, setGroupMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // Refs для быстрого доступа
  const userIdRef = useRef(null);
  const sessionIdRef = useRef('');
  const deviceIdRef = useRef(getDeviceId());
  const groupMembersRef = useRef([]);
  const statsIntervalRef = useRef(null);

  // Быстрая загрузка из VKStorage
  useEffect(() => {
    const loadVKData = async () => {
      try {
        // Пытаемся получить данные из VKStorage
        const vkData = await storage.get('metro_user_data');
        if (vkData) {
          const userData = safeJSONParse(vkData);
          if (userData) {
            // Мгновенно применяем данные
            if (userData.userId) userIdRef.current = userData.userId;
            if (userData.sessionId) sessionIdRef.current = userData.sessionId;
            
            // Обновляем состояния без лишних ререндеров
            if (userData.nickname) setNickname(userData.nickname);
            if (userData.city) setSelectedCity(userData.city);
            if (userData.gender) setSelectedGender(userData.gender);
            if (userData.color) setClothingColor(userData.color);
            if (userData.wagon) setWagonNumber(userData.wagon);
            if (userData.station) setCurrentSelectedStation(userData.station);
            if (userData.position) setSelectedPosition(userData.position);
            if (userData.mood) setSelectedMood(userData.mood);
            
            // Проверяем статус
            if (userData.joined) {
              setCurrentScreen('joined');
            } else if (userData.waiting) {
              setCurrentScreen('waiting');
            }
          }
        }
      } catch (e) {
        // Игнорируем ошибки VKStorage
      }
      
      // Параллельно загружаем статистику
      loadStats();
    };
    
    loadVKData();
    
    // Инициализация VK Bridge
    bridge.send("VKWebAppInit");
    
    // Настраиваем интервал обновления статистики
    statsIntervalRef.current = setInterval(() => {
      if (currentScreen === 'waiting' || currentScreen === 'joined') {
        loadStats(true);
      }
    }, 30000); // Обновляем каждые 30 секунд
    
    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
      }
    };
  }, []);

  // Быстрое сохранение в localStorage и VKStorage
  const saveToStorage = useCallback(async () => {
    const data = {
      userId: userIdRef.current,
      sessionId: sessionIdRef.current,
      nickname,
      city: selectedCity,
      gender: selectedGender,
      color: clothingColor,
      wagon: wagonNumber,
      station: currentSelectedStation,
      position: selectedPosition,
      mood: selectedMood,
      waiting: currentScreen === 'waiting',
      joined: currentScreen === 'joined'
    };
    
    // Сохраняем в localStorage (мгновенно)
    localStorage.setItem('screen', currentScreen);
    localStorage.setItem('city', selectedCity);
    localStorage.setItem('gender', selectedGender);
    localStorage.setItem('position', selectedPosition);
    localStorage.setItem('mood', selectedMood);
    localStorage.setItem('wagon', wagonNumber);
    localStorage.setItem('color', clothingColor);
    localStorage.setItem('name', nickname);
    if (currentSelectedStation) {
      localStorage.setItem('station', currentSelectedStation);
    }
    
    // Сохраняем в VKStorage (асинхронно, не блокируем UI)
    storage.set('metro_user_data', JSON.stringify(data));
  }, [nickname, selectedCity, selectedGender, clothingColor, wagonNumber, 
      currentSelectedStation, selectedPosition, selectedMood, currentScreen]);

  // Автосохранение при изменении данных
  useEffect(() => {
    saveToStorage();
  }, [nickname, selectedCity, selectedGender, clothingColor, wagonNumber, 
      currentSelectedStation, selectedPosition, selectedMood, currentScreen]);

  // Быстрая загрузка статистики с кэшем
  const loadStats = useCallback(async (force = false) => {
    const now = Date.now();
    
    // Используем кэш если данные свежие (менее 10 секунд)
    if (!force && dataCache.stats && (now - dataCache.lastUpdate < 10000)) {
      setStationsData(dataCache.stats);
      return dataCache.stats;
    }
    
    try {
      // Загружаем параллельно статистику и пользователей
      const [stats, users] = await Promise.all([
        api.getStationsStats(selectedCity).catch(() => null),
        api.getUsers().catch(() => [])
      ]);
      
      if (stats) {
        dataCache.stats = stats;
        dataCache.users = users;
        dataCache.lastUpdate = now;
        setStationsData(stats);
        
        // Обновляем участников группы если мы на экране joined
        if (currentScreen === 'joined' && currentSelectedStation) {
          const group = [];
          const usersList = users || [];
          
          // Оптимизированный цикл
          for (let i = 0; i < usersList.length; i++) {
            const user = usersList[i];
            if (user.station === currentSelectedStation && 
                user.is_connected === true &&
                user.online === true) {
              group.push(user);
            }
          }
          
          groupMembersRef.current = group;
          setGroupMembers(group);
        }
        
        return stats;
      }
    } catch (e) {
      // Используем кэш при ошибке
      if (dataCache.stats) {
        setStationsData(dataCache.stats);
        return dataCache.stats;
      }
    }
    
    return null;
  }, [selectedCity, currentScreen, currentSelectedStation]);

  // Быстрая регистрация
  const handleEnterWaitingRoom = async () => {
    const trimmedName = nickname.trim();
    if (!trimmedName) {
      setErrors({ nickname: true });
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Введите никнейм' });
      return;
    }
    
    setIsLoading(true);
    
    try {
      const deviceId = deviceIdRef.current;
      const newSessionId = `s_${deviceId}_${Date.now()}`;
      
      // Пытаемся найти существующего пользователя
      const users = await api.getUsers().catch(() => []);
      let existingUser = null;
      
      // Оптимизированный поиск
      for (let i = 0; i < users.length; i++) {
        if (users[i].device_id === deviceId && users[i].online === true) {
          existingUser = users[i];
          break;
        }
      }
      
      let userId;
      
      if (existingUser) {
        // Обновляем существующего
        userId = existingUser.id;
        await api.updateUser(userId, {
          name: trimmedName,
          city: selectedCity,
          gender: selectedGender,
          session_id: newSessionId,
          online: true,
          is_waiting: true,
          is_connected: false,
          last_seen: new Date().toISOString(),
          status: 'В режиме ожидания'
        });
      } else {
        // Создаем нового
        const newUser = await api.createUser({
          name: trimmedName,
          city: selectedCity,
          gender: selectedGender,
          session_id: newSessionId,
          device_id: deviceId,
          online: true,
          is_waiting: true,
          is_connected: false,
          status: 'В режиме ожидания',
          last_seen: new Date().toISOString(),
          colorCode: helpers.getRandomColor()
        });
        
        userId = newUser?.id;
      }
      
      if (userId) {
        userIdRef.current = userId;
        sessionIdRef.current = newSessionId;
        
        // Мгновенно переключаем экран
        setCurrentScreen('waiting');
        
        // Сохраняем
        saveToStorage();
        
        // Фоновая загрузка статистики
        setTimeout(() => loadStats(true), 100);
      }
    } catch (e) {
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Ошибка' });
    } finally {
      setIsLoading(false);
    }
  };

  // Быстрое присоединение к станции
  const handleConfirmStation = async () => {
    if (!clothingColor.trim()) {
      setErrors({ color: true });
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Укажите цвет одежды' });
      return;
    }
    
    if (!currentSelectedStation) {
      setErrors({ station: true });
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Выберите станцию' });
      return;
    }

    if (!userIdRef.current) {
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Создайте профиль' });
      return;
    }

    setIsLoading(true);
    
    try {
      // Обновляем пользователя
      await api.updateUser(userIdRef.current, {
        station: currentSelectedStation,
        wagon: wagonNumber,
        color: clothingColor.trim(),
        is_waiting: false,
        is_connected: true,
        online: true,
        last_seen: new Date().toISOString(),
        status: `На станции: ${currentSelectedStation}`
      });

      // Мгновенно обновляем UI
      setGroupMembers([]);
      setCurrentScreen('joined');
      
      // Сохраняем
      saveToStorage();
      
      // Загружаем участников в фоне
      setTimeout(() => loadStats(true), 100);
      
      bridge.send("VKWebAppShowSnackbar", {
        text: `✅ Вы на станции ${currentSelectedStation}`
      });
    } catch (e) {
      bridge.send("VKWebAppShowSnackbar", { text: '❌ Ошибка' });
    } finally {
      setIsLoading(false);
    }
  };

  // Быстрый выход из группы
  const handleLeaveGroup = async () => {
    if (userIdRef.current) {
      // Не ждем ответа
      api.updateUser(userIdRef.current, { 
        is_waiting: true,
        is_connected: false,
        station: '',
        status: 'В режиме ожидания'
      }).catch(() => {});
    }
    
    // Мгновенно обновляем UI
    setCurrentGroup(null);
    setCurrentScreen('waiting');
    setSelectedPosition('');
    setSelectedMood('');
    
    // Сохраняем
    saveToStorage();
    
    bridge.send("VKWebAppShowSnackbar", { text: 'Вы вернулись в ожидание' });
  };

  // Быстрое обновление состояния (позиция/настроение)
  const updateState = useCallback(async (type, value) => {
    if (type === 'position') {
      setSelectedPosition(value);
    } else {
      setSelectedMood(value);
    }
    
    // Сохраняем в localStorage
    localStorage.setItem(type === 'position' ? 'position' : 'mood', value);
    
    // Отправляем на сервер с небольшой задержкой (не блокируем UI)
    if (userIdRef.current) {
      setTimeout(() => {
        api.updateUser(userIdRef.current, {
          [type]: value,
          status: type === 'position' 
            ? `${value} | ${selectedMood || '...'}`
            : `${selectedPosition || '...'} | ${value}`
        }).catch(() => {});
      }, 300);
    }
    
    // Обновляем локально участников группы
    if (groupMembersRef.current.length > 0 && userIdRef.current) {
      const updatedMembers = [];
      for (let i = 0; i < groupMembersRef.current.length; i++) {
        const member = groupMembersRef.current[i];
        if (member.id === userIdRef.current) {
          updatedMembers.push({
            ...member,
            [type]: value,
            status: type === 'position'
              ? `${value} | ${selectedMood || '...'}`
              : `${selectedPosition || '...'} | ${value}`
          });
        } else {
          updatedMembers.push(member);
        }
      }
      groupMembersRef.current = updatedMembers;
      setGroupMembers(updatedMembers);
    }
  }, [selectedPosition, selectedMood]);

  // Рендер карты станций (оптимизированный)
  const renderStationsMap = () => {
    const { stationStats = [] } = stationsData;
    const cityStations = helpers.stations[selectedCity] || [];
    
    return cityStations.map(station => {
      const stat = stationStats.find(s => s.station === station) || 
                  { waiting: 0, connected: 0 };
      const isSelected = currentSelectedStation === station;
      let className = 'station-map-item';
      
      if (isSelected) className += ' selected';
      else if (stat.connected > 0) className += ' connected';
      else if (stat.waiting > 0) className += ' waiting';
      else className += ' empty';
      
      return (
        <div 
          key={station}
          className={className}
          onClick={() => {
            setCurrentSelectedStation(station);
            setErrors({ station: false });
          }}
        >
          <div className="station-name">{station}</div>
          <div className="station-counts">
            {stat.waiting > 0 && (
              <span className="count-waiting">{stat.waiting}⏳</span>
            )}
            {stat.connected > 0 && (
              <span className="count-connected">{stat.connected}✅</span>
            )}
          </div>
        </div>
      );
    });
  };

  // Рендер участников группы (оптимизированный)
  const renderGroupMembers = () => {
    if (groupMembers.length === 0) {
      return <div className="no-requests">Нет участников на станции</div>;
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
                  {user.position && <span>{user.position}</span>}
                  {user.position && user.mood && ' • '}
                  {user.mood && <span>{user.mood}</span>}
                </div>
              )}
              {user.color && (
                <div style={{fontSize: '12px', color: '#666'}}>
                  🎨 {user.color}
                  {user.wagon && user.wagon !== '' && (
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

  return (
    <div className="app-container">
      {isLoading && (
        <div className="loader-card">
          <div className="loader-1"><div className="neuromorphic-circle"></div></div>
        </div>
      )}
      
      <div className="container">
        <header>
          <div className="header-main">
            <div className="header-title">
              <h1>Метрос</h1>
              <div className="subtitle">Встречай попутчика🚉✔</div>
            </div>
          </div>
        </header>
        
        <div className="content">
          {/* Экран настройки */}
          {currentScreen === 'setup' && (
            <div id="setup-screen" className="screen active">
              <h2>Настройка профиля</h2>
              
              <div className="form-group">
                <label>Никнейм *</label>
                <input 
                  type="text" 
                  placeholder="Придумайте имя" 
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    setErrors({ nickname: false });
                  }}
                  className={errors.nickname ? 'error-input' : ''}
                  autoFocus
                />
              </div>
              
              <div className="form-group">
                <label>Город:</label>
                <div className="city-options">
                  <div 
                    className={`city-option moscow ${selectedCity === 'moscow' ? 'active' : ''}`}
                    onClick={() => setSelectedCity('moscow')}
                  >
                    <div className="city-name">Москва</div>
                  </div>
                  <div 
                    className={`city-option spb ${selectedCity === 'spb' ? 'active' : ''}`}
                    onClick={() => setSelectedCity('spb')}
                  >
                    <div className="city-name">Санкт-Петербург</div>
                  </div>
                </div>
              </div>
              
              <div className="form-group">
                <label>Пол:</label>
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
                {isLoading ? '...' : 'Войти в ожидание'}
              </button>
            </div>
          )}

          {/* Экран ожидания */}
          {currentScreen === 'waiting' && (
            <div id="waiting-room-screen" className="screen">
              <button className="back-btn" onClick={() => setCurrentScreen('setup')}>
                ← Изменить
              </button>
              
              <h2>Комната ожидания</h2>
              
              <div className="stations-map-container">
                <h3>🗺️ Карта станций</h3>
                
                <div className="map-legend">
                  <div className="legend-item">
                    <div className="legend-color connected"></div>
                    <span>Выбрали: {stationsData.totalStats?.total_connected || 0}</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-color waiting"></div>
                    <span>Ожидают: {stationsData.totalStats?.total_waiting || 0}</span>
                  </div>
                </div>
                
                <div className="metro-map">
                  {renderStationsMap()}
                </div>
              </div>

              <div className="user-settings-panel">
                <h4>Ваши параметры</h4>
                
                <div className="form-group">
                  <label>Вагон</label>
                  <select 
                    value={wagonNumber}
                    onChange={(e) => setWagonNumber(e.target.value)}
                  >
                    <option value="">Не указан</option>
                    {[1,2,3,4,5,6,7,8].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Цвет одежды *</label>
                  <input 
                    type="text" 
                    placeholder="Например: красная куртка" 
                    value={clothingColor}
                    onChange={(e) => {
                      setClothingColor(e.target.value);
                      setErrors({ color: false });
                    }}
                    className={errors.color ? 'error-input' : ''}
                  />
                </div>
                
                <button 
                  className="btn btn-success" 
                  onClick={handleConfirmStation}
                  disabled={isLoading}
                >
                  {isLoading ? '...' : 'Присоединиться'}
                </button>
              </div>
            </div>
          )}

          {/* Экран присоединения */}
          {currentScreen === 'joined' && (
            <div id="joined-room-screen" className="screen">
              <button className="back-btn" onClick={handleLeaveGroup}>
                ← К поиску
              </button>
              
              <h2>Станция {currentSelectedStation}</h2>
              
              <div className="status-indicators">
                <div>📍 {selectedPosition || 'Позиция не выбрана'}</div>
                <div>😊 {selectedMood || 'Настроение не выбрано'}</div>
              </div>
              
              <div className="state-section">
                <h4>🎯 Позиция</h4>
                <div className="state-cards">
                  {[
                    { pos: "Брожу по станции", icon: "🚶" },
                    { pos: "Сижу на станции", icon: "🙋" },
                    { pos: "Иду к поезду", icon: "🚀" },
                    { pos: "Стою в центре вагона", icon: "🧍" },
                    { pos: "Стою у двери", icon: "🚪" },
                    { pos: "Сижу в вагоне", icon: "💺" }
                  ].map(({pos, icon}) => (
                    <div 
                      key={pos}
                      className={`state-card ${selectedPosition === pos ? 'active' : ''}`}
                      onClick={() => updateState('position', pos)}
                    >
                      <div className="state-icon">{icon}</div>
                      <div className="state-name">{pos}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="state-section">
                <h4>😊 Настроение</h4>
                <div className="state-cards">
                  {[
                    { mood: "Наблюдаю", icon: "👀" },
                    { mood: "Хорошее", icon: "😊" },
                    { mood: "Жду", icon: "⏳" },
                    { mood: "Сплю", icon: "😴" },
                    { mood: "Готов(а) подойти", icon: "🚶" }
                  ].map(({mood, icon}) => (
                    <div 
                      key={mood}
                      className={`state-card ${selectedMood === mood ? 'active' : ''}`}
                      onClick={() => updateState('mood', mood)}
                    >
                      <div className="state-icon">{icon}</div>
                      <div className="state-name">{mood}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="users-list-section">
                <h3>👥 Участники ({groupMembers.length})</h3>
                <div id="group-members">
                  {renderGroupMembers()}
                </div>
              </div>
              
              <button className="btn btn-danger" onClick={handleLeaveGroup}>
                Покинуть
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};