import { createApp } from 'vue';
import { createPinia } from 'pinia';

import './presentation/theme.css';
import App from './App.vue';

createApp(App).use(createPinia()).mount('#app');
