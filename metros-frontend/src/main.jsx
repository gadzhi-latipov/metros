import { createRoot } from 'react-dom/client'
import { AppConfig } from './AppConfig.jsx'
import './App.css'

console.log('🚀 main.jsx загружен успешно!')

const container = document.getElementById('root');
if (!container) {
  console.error('❌ Контейнер #root не найден!')
} else {
  console.log('✅ Контейнер #root найден')
}

const root = createRoot(container);
root.render(<AppConfig />);