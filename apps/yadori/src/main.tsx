import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('App root is missing.');
ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
);
