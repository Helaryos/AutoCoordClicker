// ==UserScript==
// @name         自动点击仙人
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  定时点击给定的坐标。支持配置多个目标，独立控制，时间、位置随机抖动，允许导入导出配置。
// @author       Helaryos (with Gemini)
// @match        *://* // EDIT THIS LINE BEFORE YOU USE IT 必须在这一行设置适用的网址。
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_info
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration and State Variables ---
    const SCRIPT_NAME = "自动点击仙人";
    const SCRIPT_VERSION = GM_info.script.version || "1.6";
    const EXPORT_FORMAT_VERSION = "1.0";
    const STORAGE_KEY_SUFFIX = '_v1.0'; // Increment suffix

    let targetTimeouts = {};
    let isGloballyClicking = false;
    let isSelecting = false;
    let isDragging = false;
    let offsetX, offsetY;
    const MAX_LOG_ENTRIES = 100;

    // --- Load Saved Settings or Use Defaults ---
    let clickTargets = GM_getValue(`clickTargets${STORAGE_KEY_SUFFIX}`, []);
    let selectedTargetId = GM_getValue(`selectedTargetId${STORAGE_KEY_SUFFIX}`, null);
    let panelOpacity = GM_getValue(`panelOpacity${STORAGE_KEY_SUFFIX}`, 1.0);
    let logVisible = GM_getValue(`logVisible${STORAGE_KEY_SUFFIX}`, false);
    let isPanelCollapsed = GM_getValue(`isPanelCollapsed${STORAGE_KEY_SUFFIX}`, false);
    let panelPosition = GM_getValue(`panelPosition${STORAGE_KEY_SUFFIX}`, { bottom: '10px', right: '10px' });

    // --- Ensure at least one target exists ---
    if (clickTargets.length === 0) {
        const defaultTargetId = Date.now();
        clickTargets.push({ id: defaultTargetId, name: '目标 1', mainX: 100, mainY: 100, iframePath: null, iframeX: null, iframeY: null, intervalSeconds: 5, clickRadius: 10, timeJitterPlus: 1, timeJitterMinus: 1, isActive: true });
        selectedTargetId = defaultTargetId;
        GM_setValue(`clickTargets${STORAGE_KEY_SUFFIX}`, clickTargets);
        GM_setValue(`selectedTargetId${STORAGE_KEY_SUFFIX}`, selectedTargetId);
    } else if (!selectedTargetId || !clickTargets.find(t => t.id === selectedTargetId)) {
        selectedTargetId = clickTargets[0]?.id || null;
        GM_setValue(`selectedTargetId${STORAGE_KEY_SUFFIX}`, selectedTargetId);
    }

    // --- Create Control Panel ---
    const panel = document.createElement('div');
    panel.id = 'coord-clicker-panel';
    panel.style.opacity = panelOpacity;
    Object.assign(panel.style, panelPosition);
    if (isPanelCollapsed) panel.classList.add('collapsed');

    // --- Panel HTML (Removed invalid comments, adjusted layout) ---
    panel.innerHTML = `
        <div id="coord-clicker-header" style="cursor: pointer; background-color: #444; color: white; padding: 2px 5px; text-align: left; position: relative; height: 24px; line-height: 20px;" title="点击折叠/展开 | 拖动移动">
            <span id="panel-title">${SCRIPT_NAME} V${SCRIPT_VERSION}</span>
            <span id="collapse-indicator" style="margin-left: 5px;">${isPanelCollapsed ? '▼' : '▲'}</span>
            <button id="select-coord-btn" title="选择当前目标的坐标中心点" style="padding: 1px 3px; position: absolute; right: 5px; top: 3px; height: 18px; line-height: 1; color: black;">选择坐标</button>
        </div>
        <div id="panel-content" style="padding: 5px; font-size: 0.8em;">
            <div style="display: flex; align-items: center; margin-bottom: 4px; gap: 4px;">
                <select id="target-selector" title="选择目标" style="min-width: 50px; flex-shrink: 1; flex-grow: 0; max-width: 40px;"></select>
                <input type="text" id="target-name-input" title="编辑目标名称" placeholder="目标名称" style="flex-grow: 1; min-width: 40px;">
                <input type="checkbox" id="target-active-checkbox" style="margin-left: auto; flex-shrink: 0;" title="是否激活此目标">
                <button id="add-target-btn" title="添加新目标" style="padding: 1px 5px; font-size: 1.1em; flex-shrink: 0;">+</button>
                <button id="delete-target-btn" title="删除当前目标" style="padding: 1px 5px; font-size: 1.1em; flex-shrink: 0;" disabled>-</button>
            </div>
            <hr style="margin: 4px 0;">
            <div style="display: flex; align-items: center; margin-bottom: 4px; gap: 5px;">
                <label title="主窗口 X 坐标">X: <input type="number" id="coord-x" style="width: 40px;"></label>
                <label title="主窗口 Y 坐标">Y: <input type="number" id="coord-y" style="width: 40px;"></label>
                <label title="点击位置随机偏移半径（像素）" style="margin-left: auto; display: inline-flex; align-items: center; gap: 3px;">随机:
                    <input type="range" id="click-radius-slider" min="0" max="100" style="width: 45px; height: 12px; vertical-align: middle;">
                    <span id="click-radius-value" style="display: inline-block; width: 25px; text-align: right;"></span>
                </label>
                <span id="iframe-info" style="font-size: 0.9em; color: #007bff; flex-shrink: 0; text-align: right; max-width: 30px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;" title=""></span>
            </div>
            <hr style="margin: 4px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 5px;">
                 <label title="基础间隔(秒)">间隔(s): <input type="number" id="interval-seconds" min="0.1" step="0.1" style="width: 60px;"></label>
                 <label title="时间抖动(-/+ 秒)">抖动: -<input type="number" id="time-jitter-minus" min="0" step="0.1" style="width: 35px;"> +<input type="number" id="time-jitter-plus" min="0" step="0.1" style="width: 35px;"></label>
            </div>
            <hr style="margin: 4px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 5px;">
                 <div style="display: flex; align-items: center; gap: 4px;">
                     <button id="start-btn" style="padding: 1px 5px;">开始</button>
                     <button id="stop-btn" disabled style="padding: 1px 5px;">停止</button>
                     <button id="toggle-log-btn" style="padding: 1px 4px;" title="显示/隐藏日志">${logVisible ? '隐藏日志' : '显示日志'}</button>
                 </div>
                 <label title="调整面板透明度" style="margin-left: auto; display: inline-flex; align-items: center; gap: 3px;">透明:
                    <input type="range" id="panel-opacity-slider" min="0.1" max="1" step="0.05" value="${panelOpacity}" style="width: 40px; height: 12px; vertical-align: middle;">
                    <span id="panel-opacity-value" style="display: inline-block; width: 30px; text-align: right;">${Math.round(panelOpacity * 100)}%</span>
                 </label>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px; border-top: 1px solid #eee; padding-top: 5px; gap: 4px;">
                 <div id="status-display" style="flex-grow: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">状态：已停止</div>
                 <button id="import-settings-btn" title="导入设置" style="padding: 1px 4px; flex-shrink: 0;">导入</button>
                 <button id="export-settings-btn" title="导出设置" style="padding: 1px 4px; flex-shrink: 0;">导出</button>
                 <input type="file" id="import-file-input" accept=".json" style="display: none;">
            </div>
            <div id="log-display-area" style="max-height: 70px; overflow-y: auto; border: 1px solid #ccc; background-color: #f8f9fa; padding: 3px; margin-top: 5px; line-height: 1.2; display: ${logVisible ? 'block' : 'none'};">
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    // --- Create Highlighter and Marker Elements ---
    const highlighter = document.createElement('div');
    highlighter.id = 'coord-clicker-highlighter';
    document.body.appendChild(highlighter);
    const allMarkersContainer = document.createElement('div');
    allMarkersContainer.id = 'coord-clicker-all-markers-container';
    document.body.appendChild(allMarkersContainer);
    const clickAnimationContainer = document.createElement('div');
    clickAnimationContainer.id = 'coord-clicker-animation-container';
    document.body.appendChild(clickAnimationContainer);


    // --- Add Styles ---
     GM_addStyle(`
        #coord-clicker-panel {
            position: fixed; background-color: rgba(240, 240, 240, 0.95);
            border: 1px solid #ccc; border-radius: 4px; z-index: 99999;
            font-family: sans-serif; font-size: 11px;
            box-shadow: 2px 2px 5px rgba(0,0,0,0.2); color: #333;
            line-height: 1.3; width: 240px;
            transition: height 0.3s ease, opacity 0.2s ease;
        }
        #coord-clicker-panel.collapsed #panel-content { display: none; }
        #coord-clicker-panel button { margin: 0; cursor: pointer; border-radius: 3px; border: 1px solid #aaa; background-color: #eee; vertical-align: middle; font-size: 1em; }
        #coord-clicker-panel button:disabled { cursor: not-allowed; background-color: #ddd; color: #888; }
        #coord-clicker-panel button:hover:not(:disabled) { background-color: #ddd; }
        #coord-clicker-panel input[type="number"],
        #coord-clicker-panel input[type="text"],
        #coord-clicker-panel select { padding: 1px 3px; border: 1px solid #ccc; border-radius: 3px; vertical-align: middle; height: 20px; box-sizing: border-box; font-size: 1em; }
        #coord-clicker-panel input[type="range"] { cursor: pointer; vertical-align: middle; height: 12px !important; padding: 0;}
        #coord-clicker-panel input[type="checkbox"] { vertical-align: middle; margin: 0; padding: 0; }
        #coord-clicker-panel label { margin-right: 2px; vertical-align: middle; display: inline-flex; align-items: center; gap: 2px; }
        #coord-clicker-header { position: relative; font-size: 1.1em; }
        #coord-clicker-header:active #panel-title { cursor: grabbing; }
        #collapse-indicator { display: inline-block; }
        #coord-clicker-highlighter {
            position: fixed; border: 2px solid red; border-radius: 50%;
            background-color: rgba(255, 0, 0, 0.1); z-index: 99998;
            pointer-events: none; display: none;
            transition: opacity 0.2s ease, width 0.1s ease, height 0.1s ease;
            box-sizing: border-box; transform: translate(-50%, -50%);
        }
        #coord-clicker-all-markers-container {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none; z-index: 99997;
        }
        .target-marker {
            position: absolute; border: 1px solid blue;
            border-radius: 50%; background-color: rgba(0, 0, 255, 0.1);
            box-sizing: border-box; transform: translate(-50%, -50%);
            pointer-events: none;
        }
        .target-marker-label {
            position: absolute; transform: translate(-50%, -150%);
            font-size: 9px; color: blue; background-color: rgba(255, 255, 255, 0.7);
            padding: 0 2px; border-radius: 2px; white-space: nowrap;
            pointer-events: none;
        }
        #log-display-area { font-size: 8px; } /* Log font size */
        #log-display-area .log-entry { margin-bottom: 1px; word-wrap: break-word; }
        #log-display-area .log-time { color: #6c757d; margin-right: 4px; font-size: 0.9em;}
        #log-display-area .log-info {}
        #log-display-area .log-warn { color: #ffc107; }
        #log-display-area .log-error { color: #dc3545; font-weight: bold;}

        #coord-clicker-animation-container { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 100000; }
        .click-animation-marker {
            position: absolute; border: 2px solid rgba(255, 0, 0, 0.7);
            border-radius: 50%; width: 10px; height: 10px;
            transform: translate(-50%, -50%); opacity: 1;
            transition: width 0.4s ease-out, height 0.4s ease-out, opacity 0.4s ease-out, border-color 0.4s ease-out;
        }
    `);

    // --- Get UI Elements ---
    const xInput = document.getElementById('coord-x');
    const yInput = document.getElementById('coord-y');
    const intervalInput = document.getElementById('interval-seconds');
    const selectBtn = document.getElementById('select-coord-btn');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const statusDisplay = document.getElementById('status-display');
    const iframeInfoDisplay = document.getElementById('iframe-info');
    const header = document.getElementById('coord-clicker-header');
    const radiusSlider = document.getElementById('click-radius-slider');
    const radiusValueSpan = document.getElementById('click-radius-value');
    const jitterPlusInput = document.getElementById('time-jitter-plus');
    const jitterMinusInput = document.getElementById('time-jitter-minus');
    const opacitySlider = document.getElementById('panel-opacity-slider');
    const opacityValueSpan = document.getElementById('panel-opacity-value');
    const toggleLogBtn = document.getElementById('toggle-log-btn');
    const logDisplayArea = document.getElementById('log-display-area');
    const targetSelector = document.getElementById('target-selector');
    const addTargetBtn = document.getElementById('add-target-btn');
    const deleteTargetBtn = document.getElementById('delete-target-btn');
    const targetNameInput = document.getElementById('target-name-input');
    const targetActiveCheckbox = document.getElementById('target-active-checkbox');
    const panelContent = document.getElementById('panel-content');
    const collapseIndicator = document.getElementById('collapse-indicator');
    const importSettingsBtn = document.getElementById('import-settings-btn');
    const exportSettingsBtn = document.getElementById('export-settings-btn');
    const importFileInput = document.getElementById('import-file-input');


    // --- UI Logger ---
    function logToPanel(message, level = 'info') { if (!logDisplayArea) return; const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false }); const logEntry = document.createElement('div'); logEntry.classList.add('log-entry', `log-${level}`); const timeSpan = document.createElement('span'); timeSpan.classList.add('log-time'); timeSpan.textContent = timestamp; const msgSpan = document.createElement('span'); msgSpan.textContent = message; logEntry.appendChild(timeSpan); logEntry.appendChild(msgSpan); logDisplayArea.appendChild(logEntry); while (logDisplayArea.childNodes.length > MAX_LOG_ENTRIES) { logDisplayArea.removeChild(logDisplayArea.firstChild); } if (logVisible && !isPanelCollapsed) { logDisplayArea.scrollTop = logDisplayArea.scrollHeight; } if (level === 'error') { console.error(`[UI LOG ERROR] ${timestamp} - ${message}`); } }

    // --- Helper Functions ---
    function getSelectedTarget() { return clickTargets.find(t => t.id === selectedTargetId) || null; }
    function saveTargets() { try { GM_setValue(`clickTargets${STORAGE_KEY_SUFFIX}`, clickTargets); } catch (e) { logToPanel(`保存目标列表时出错: ${e.message}`, 'error'); } }
    function saveOtherSettings() {
        try {
            GM_setValue(`panelOpacity${STORAGE_KEY_SUFFIX}`, panelOpacity);
            GM_setValue(`logVisible${STORAGE_KEY_SUFFIX}`, logVisible);
            GM_setValue(`isPanelCollapsed${STORAGE_KEY_SUFFIX}`, isPanelCollapsed);
            GM_setValue(`panelPosition${STORAGE_KEY_SUFFIX}`, panelPosition);
            GM_setValue(`selectedTargetId${STORAGE_KEY_SUFFIX}`, selectedTargetId);
        } catch (e) { logToPanel(`保存其他设置时出错: ${e.message}`, 'error'); }
    }

    // --- Update All Persistent Markers ---
    function updateAllMarkers() {
        allMarkersContainer.innerHTML = '';
        clickTargets.forEach(target => {
            if (target && target.mainX != null && target.mainY != null) {
                const radius = target.clickRadius || 0;
                const diameter = Math.max(4, radius * 2);
                const marker = document.createElement('div');
                marker.className = 'target-marker';
                marker.style.width = `${diameter}px`; marker.style.height = `${diameter}px`;
                marker.style.left = `${target.mainX}px`; marker.style.top = `${target.mainY}px`;
                const label = document.createElement('span');
                label.className = 'target-marker-label';
                label.textContent = target.name || `目标 ${target.id}`;
                label.style.left = `${target.mainX}px`; label.style.top = `${target.mainY}px`;
                allMarkersContainer.appendChild(marker); allMarkersContainer.appendChild(label);
            }
        });
    }

    function findIframeByPath(path) { if (!path) return null; try { return document.querySelector(path); } catch (e) { logToPanel(`查找 iframe 时出错: ${path} - ${e.message}`, 'error'); return null; } }
    function getElementPath(element) { if (!element || element.nodeType !== Node.ELEMENT_NODE) return null; const parts = []; while (element && element.tagName.toLowerCase() !== 'body') { let selector = element.tagName.toLowerCase(); if (element.id) { if (!/^\d+$/.test(element.id)) { selector += '#' + CSS.escape(element.id); parts.unshift(selector); break; } } let sibling = element; let nth = 1; while (sibling = sibling.previousElementSibling) { if (sibling.tagName === element.tagName) { nth++; } } selector += `:nth-of-type(${nth})`; parts.unshift(selector); element = element.parentNode; if (!element || element.nodeType !== Node.ELEMENT_NODE) break; } return parts.length ? parts.join(' > ') : null; }

    // --- UI Update Functions ---
    function populateTargetSelector() {
        const previousSelectedId = selectedTargetId;
        targetSelector.innerHTML = '';
        clickTargets.forEach(target => {
            const option = document.createElement('option');
            option.value = target.id;
            option.textContent = target.name || `目标 ${target.id}`; // Show Name
            option.title = `${target.name || '未命名'} (ID: ${target.id})`;
            if (target.id === selectedTargetId) option.selected = true;
            targetSelector.appendChild(option);
        });

        if (!clickTargets.find(t => t.id === selectedTargetId) && clickTargets.length > 0) {
            selectedTargetId = clickTargets[0].id;
            if (targetSelector.options.length > 0) targetSelector.options[0].selected = true;
        } else if (clickTargets.length === 0) {
            selectedTargetId = null;
        } else if (targetSelector.value !== selectedTargetId?.toString()) {
             targetSelector.value = selectedTargetId;
        }

        deleteTargetBtn.disabled = (clickTargets.length <= 1 || isGloballyClicking);
        if (selectedTargetId !== previousSelectedId || clickTargets.length === 0) {
            updateUIForSelectedTarget();
        }
    }


    function updateUIForSelectedTarget() {
        const target = getSelectedTarget();
        const isCurrentlyClicking = isGloballyClicking;

        if (target) {
            targetNameInput.value = target.name || '';
            targetActiveCheckbox.checked = target.isActive;
            xInput.value = target.mainX; yInput.value = target.mainY;
            intervalInput.value = target.intervalSeconds;
            jitterPlusInput.value = target.timeJitterPlus; jitterMinusInput.value = target.timeJitterMinus;
            radiusSlider.value = target.clickRadius; radiusValueSpan.textContent = `${target.clickRadius}px`;
            const iframeName = target.iframePath ? target.iframePath.split('>').pop().trim() : '';
            iframeInfoDisplay.textContent = target.iframePath ? `(i)` : '';
            iframeInfoDisplay.title = target.iframePath || '';
        } else {
            targetNameInput.value = ''; targetActiveCheckbox.checked = false;
            xInput.value = ''; yInput.value = ''; intervalInput.value = '';
            jitterPlusInput.value = ''; jitterMinusInput.value = '';
            radiusSlider.value = 0; radiusValueSpan.textContent = '0px';
            iframeInfoDisplay.textContent = ''; iframeInfoDisplay.title = '';
        }

        const controlsDisabled = isCurrentlyClicking || !target;
        targetNameInput.disabled = controlsDisabled; targetActiveCheckbox.disabled = controlsDisabled;
        xInput.disabled = controlsDisabled; yInput.disabled = controlsDisabled;
        selectBtn.disabled = controlsDisabled; intervalInput.disabled = controlsDisabled;
        jitterPlusInput.disabled = controlsDisabled; jitterMinusInput.disabled = controlsDisabled;
        radiusSlider.disabled = controlsDisabled;

        addTargetBtn.disabled = isCurrentlyClicking;
        deleteTargetBtn.disabled = isCurrentlyClicking || (clickTargets.length <= 1);

        updateAllMarkers();
    }

    function updateGeneralUISettings() {
        opacitySlider.value = panelOpacity; panel.style.opacity = panelOpacity;
        opacityValueSpan.textContent = `${Math.round(panelOpacity * 100)}%`;
        logDisplayArea.style.display = logVisible ? 'block' : 'none';
        toggleLogBtn.textContent = logVisible ? '隐藏日志' : '显示日志';
        panel.classList.toggle('collapsed', isPanelCollapsed);
        collapseIndicator.textContent = isPanelCollapsed ? '▼' : '▲';
        Object.assign(panel.style, panelPosition);
    }

    // --- Click Animation Function ---
    function showClickAnimation(x, y) {
        const marker = document.createElement('div'); marker.className = 'click-animation-marker';
        marker.style.left = `${x}px`; marker.style.top = `${y}px`;
        clickAnimationContainer.appendChild(marker);
        requestAnimationFrame(() => { marker.style.width = '40px'; marker.style.height = '40px'; marker.style.opacity = '0'; marker.style.borderColor = 'rgba(255, 0, 0, 0)'; });
        setTimeout(() => { marker.remove(); }, 400);
    }


    // --- Core Clicking Logic ---
    function performSingleClick(target) {
        if (!target || typeof target.id === 'undefined') return;
        if (!targetTimeouts[target.id]) return;
        if (!target.isActive) { logToPanel(`目标 "${target.name}" 不再激活，停止计时。`, 'info'); clearTimeout(targetTimeouts[target.id]); delete targetTimeouts[target.id]; if (Object.keys(targetTimeouts).length === 0) stopClicking(); return; }

        let clickX = target.mainX; let clickY = target.mainY;
        let effectiveRadius = target.clickRadius || 0;
        if (effectiveRadius > 0) { const angle = Math.random() * 2 * Math.PI; const randomRadius = effectiveRadius * Math.sqrt(Math.random()); const offsetX = randomRadius * Math.cos(angle); const offsetY = randomRadius * Math.sin(angle); clickX = Math.round(target.mainX + offsetX); clickY = Math.round(target.mainY + offsetY); }
        const eventX = clickX, eventY = clickY;

        showClickAnimation(eventX, eventY);

        let targetElement; let targetWindow = window;
        let clientX = eventX, clientY = eventY; let iframeElement = null;

        if (target.iframePath) {
            iframeElement = findIframeByPath(target.iframePath);
            if (!iframeElement) { logToPanel(`错误: 找不到 iframe "${target.iframePath}".`, 'error'); scheduleNextClickForTarget(target); return; }
            let iframeDoc;
            try {
                targetWindow = iframeElement.contentWindow; if (!targetWindow) throw new Error("Iframe contentWindow 为空");
                iframeDoc = targetWindow.document; if (!iframeDoc) throw new Error("Iframe document 为空");
                try { const loc = targetWindow.location.href; } catch (e) { throw new Error(`跨域或访问受限: ${e.message}`); }
                const rect = iframeElement.getBoundingClientRect(); clientX = eventX - rect.left; clientY = eventY - rect.top;
                targetElement = iframeDoc.elementFromPoint(clientX, clientY);
                if (!targetElement) { targetElement = iframeDoc.body; if (!targetElement) throw new Error("Iframe 中找不到 body"); }
            } catch (e) { logToPanel(`错误: 访问 iframe 时出错: ${e.message}.`, 'error'); scheduleNextClickForTarget(target); return; }
        } else {
            targetWindow = window; targetElement = document.elementFromPoint(clientX, clientY);
            if (!targetElement) targetElement = document.body;
        }

        if (!targetElement) { logToPanel(`错误: 无法确定目标元素。`, 'error'); scheduleNextClickForTarget(target); return; }
        if (!targetWindow || typeof targetWindow.document === 'undefined') { logToPanel(`错误: 目标 window 无效。`, 'error'); scheduleNextClickForTarget(target); return; }

        try {
            const eventInit = { bubbles: true, cancelable: true, clientX: clientX, clientY: clientY, screenX: eventX, screenY: eventY, button: 0, composed: true };
            targetElement.dispatchEvent(new MouseEvent('mousedown', eventInit));
            targetElement.dispatchEvent(new MouseEvent('mouseup', eventInit));
            targetElement.dispatchEvent(new MouseEvent('click', eventInit));
        } catch (error) { logToPanel(`错误: 派发事件时出错: ${error.message}`, 'error'); console.error(`Event dispatch error for ${target.name}:`, error); }

        scheduleNextClickForTarget(target);
    }

    // --- Schedule Next Click ---
    function scheduleNextClickForTarget(target) {
        if (!target || typeof target.id === 'undefined') return;
        if (!isGloballyClicking || !targetTimeouts[target.id]) { if (targetTimeouts[target.id]) { clearTimeout(targetTimeouts[target.id]); delete targetTimeouts[target.id]; } return; }
        if (!target.isActive) { logToPanel(`目标 "${target.name}" 不再激活，停止调度。`, 'info'); clearTimeout(targetTimeouts[target.id]); delete targetTimeouts[target.id]; if (Object.keys(targetTimeouts).length === 0) stopClicking(); return; }

        const baseInterval = (target.intervalSeconds || 1) * 1000;
        const jitterPlus = (target.timeJitterPlus || 0) * 1000; const jitterMinus = (target.timeJitterMinus || 0) * 1000;
        const maxNegativeJitter = Math.min(jitterMinus, baseInterval * 0.9);
        const randomJitter = Math.random() * (jitterPlus + maxNegativeJitter) - maxNegativeJitter;
        let nextInterval = baseInterval + randomJitter;
        if (nextInterval < 100) nextInterval = 100;

        logToPanel(`[Click] 目标: "${target.name}" (下次点击 ${(nextInterval / 1000).toFixed(1)}s 后)`, 'info');

        if (targetTimeouts[target.id] && targetTimeouts[target.id] !== 'pending') clearTimeout(targetTimeouts[target.id]);

        targetTimeouts[target.id] = setTimeout(() => {
            if (!isGloballyClicking || !targetTimeouts[target.id]) { if(targetTimeouts[target.id]) delete targetTimeouts[target.id]; return; }
            try { performSingleClick(target); } catch (e) { logToPanel(`错误: 执行点击时出错 (${target.name}): ${e.message}`, 'error'); console.error(`Uncaught error during performSingleClick for ${target.name}:`, e); scheduleNextClickForTarget(target); }
        }, nextInterval);
    }

    // --- Start/Stop Functions ---
    function startClicking() {
        if (isGloballyClicking) return;
        const activeTargets = clickTargets.filter(t => t.isActive);
        if (activeTargets.length === 0) { alert("没有激活的目标！"); return; }

        logToPanel(`启动 ${activeTargets.length} 个激活的目标...`);
        isGloballyClicking = true; targetTimeouts = {};
        startBtn.disabled = true; stopBtn.disabled = false;
        statusDisplay.textContent = `运行中 (${activeTargets.length}个目标)...`; statusDisplay.style.color = 'green';
        updateUIForSelectedTarget();

        activeTargets.forEach(target => { targetTimeouts[target.id] = 'pending'; scheduleNextClickForTarget(target); });
    }

    function stopClicking() {
        const wasClicking = isGloballyClicking || Object.keys(targetTimeouts).length > 0;
        if (wasClicking) logToPanel("尝试停止所有目标...");

        isGloballyClicking = false;
        let clearedCount = 0;
        for (const targetId in targetTimeouts) { if (targetTimeouts.hasOwnProperty(targetId) && targetTimeouts[targetId] && targetTimeouts[targetId] !== 'pending') { clearTimeout(targetTimeouts[targetId]); clearedCount++; } }
        if (clearedCount > 0) logToPanel(`已清除 ${clearedCount} 个计时器。`);
        targetTimeouts = {};

        startBtn.disabled = false; stopBtn.disabled = true;
        statusDisplay.textContent = '状态：已停止'; statusDisplay.style.color = '#555';
        updateUIForSelectedTarget();

        if (wasClicking) logToPanel("点击已停止。");
    }


    // --- Event Listeners ---

    // Header Collapse/Expand
    header.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        if (e.target.id === 'panel-title' || e.target.id === 'collapse-indicator' || e.target === header) {
             if (panel.style.cursor === 'grabbing') return;
             isPanelCollapsed = !isPanelCollapsed; panel.classList.toggle('collapsed', isPanelCollapsed);
             collapseIndicator.textContent = isPanelCollapsed ? '▼' : '▲';
             GM_setValue(`isPanelCollapsed${STORAGE_KEY_SUFFIX}`, isPanelCollapsed);
        }
    });

    // Target Selector Change
    targetSelector.addEventListener('change', () => {
        selectedTargetId = parseInt(targetSelector.value, 10);
        if (isNaN(selectedTargetId)) selectedTargetId = null;
        GM_setValue(`selectedTargetId${STORAGE_KEY_SUFFIX}`, selectedTargetId);
        updateUIForSelectedTarget();
    });

    // Add Target Button
    addTargetBtn.addEventListener('click', () => {
        const newId = Date.now();
        const newTarget = { id: newId, name: `目标 ${clickTargets.length + 1}`, mainX: 100, mainY: 100, iframePath: null, iframeX: null, iframeY: null, intervalSeconds: 5, clickRadius: 10, timeJitterPlus: 1, timeJitterMinus: 1, isActive: true };
        clickTargets.push(newTarget); selectedTargetId = newId;
        logToPanel(`添加了新目标 "${newTarget.name}"`);
        populateTargetSelector(); saveTargets();
        GM_setValue(`selectedTargetId${STORAGE_KEY_SUFFIX}`, selectedTargetId);
        targetNameInput.focus();
    });

    // Delete Target Button
    deleteTargetBtn.addEventListener('click', () => {
        if (clickTargets.length <= 1) { alert("不能删除最后一个目标！"); return; }
        const targetToDelete = getSelectedTarget();
        if (targetToDelete && confirm(`确定要删除目标 "${targetToDelete.name || targetToDelete.id}" 吗？`)) {
            const deletedIndex = clickTargets.findIndex(t => t.id === targetToDelete.id);
            clickTargets = clickTargets.filter(t => t.id !== targetToDelete.id);
            logToPanel(`删除了目标 "${targetToDelete.name}"`);
            if (deletedIndex > 0 && clickTargets.length > 0) selectedTargetId = clickTargets[deletedIndex - 1].id;
            else if (clickTargets.length > 0) selectedTargetId = clickTargets[0].id;
            else selectedTargetId = null;
            populateTargetSelector(); saveTargets();
            GM_setValue(`selectedTargetId${STORAGE_KEY_SUFFIX}`, selectedTargetId);
        } else if (!targetToDelete) { logToPanel("删除错误：找不到目标。", 'error'); }
    });

    // Input field listeners (Target specific)
    function addSettingChangeListener(elementId, targetProperty, isNumeric = false, isFloat = false, isBoolean = false) {
        const element = document.getElementById(elementId); if (!element) return;
        const eventType = (element.type === 'range' || elementId === 'target-name-input') ? 'input' : 'change';

        element.addEventListener(eventType, (event) => {
            const target = getSelectedTarget(); if (!target) return;
            let value = isBoolean ? event.target.checked : event.target.value;
            if (isNumeric) {
                value = isFloat ? parseFloat(value) : parseInt(value, 10);
                if (isNaN(value)) { if(eventType === 'change') logToPanel(`无效输入 "${event.target.value}" for ${targetProperty}`, 'warn'); return; }
                if (['timeJitterPlus', 'timeJitterMinus', 'clickRadius'].includes(targetProperty) && value < 0) value = 0;
                if (targetProperty === 'intervalSeconds' && value <= 0) value = 0.1;
            }
            target[targetProperty] = value;

            if (targetProperty === 'name') {
                 updateAllMarkers();
                 const option = targetSelector.querySelector(`option[value="${target.id}"]`);
                 if (option) option.textContent = value || `目标 ${target.id}`;
            } else if (targetProperty === 'clickRadius') { radiusValueSpan.textContent = `${value}px`; updateAllMarkers(); }
            else if (targetProperty === 'mainX' || targetProperty === 'mainY') { updateAllMarkers(); }

            if (eventType === 'change') {
                if (isNumeric && target[targetProperty] != event.target.value) event.target.value = target[targetProperty];
                saveTargets();
            }
        });
        if (eventType === 'input') { element.addEventListener('change', () => { const target = getSelectedTarget(); if(target) saveTargets(); }); }
    }
    addSettingChangeListener('target-name-input', 'name');
    addSettingChangeListener('target-active-checkbox', 'isActive', false, false, true);
    addSettingChangeListener('coord-x', 'mainX', true);
    addSettingChangeListener('coord-y', 'mainY', true);
    addSettingChangeListener('interval-seconds', 'intervalSeconds', true, true);
    addSettingChangeListener('time-jitter-plus', 'timeJitterPlus', true, true);
    addSettingChangeListener('time-jitter-minus', 'timeJitterMinus', true, true);
    addSettingChangeListener('click-radius-slider', 'clickRadius', true);


    // --- Coordinate Selection Logic ---
    function cancelCoordinateSelection(logCancel = false) {
        document.removeEventListener('mousemove', mouseMoveHandler, true);
        document.removeEventListener('click', selectionClickListener, true);
        document.removeEventListener('contextmenu', selectionContextMenuListener, true);
        document.body.style.cursor = 'default'; highlighter.style.display = 'none';
        selectBtn.textContent = '选择坐标'; selectBtn.disabled = isGloballyClicking || !getSelectedTarget();
        isSelecting = false;
        const target = getSelectedTarget(); if (target) { xInput.value = target.mainX; yInput.value = target.mainY; }
        if (logCancel) logToPanel("坐标选择已取消。", 'info');
    }
    const mouseMoveHandler = (event) => {
        const currentX = Math.round(event.clientX); const currentY = Math.round(event.clientY);
        highlighter.style.left = `${currentX}px`; highlighter.style.top = `${currentY}px`;
        const target = getSelectedTarget(); const radius = target?.clickRadius || 0;
        const diameter = Math.max(4, radius * 2);
        highlighter.style.width = `${diameter}px`; highlighter.style.height = `${diameter}px`;
        xInput.value = currentX; yInput.value = currentY;
    };
    const selectionContextMenuListener = (event) => { event.preventDefault(); event.stopPropagation(); cancelCoordinateSelection(true); };
    const selectionClickListener = (event) => {
         if (panel.contains(event.target)) { logToPanel("点击在面板内部，忽略。", "warn"); return; }
         event.preventDefault(); event.stopPropagation();
         const currentSelectedTarget = getSelectedTarget();
         if (currentSelectedTarget) {
             const mainX = Math.round(event.clientX); const mainY = Math.round(event.clientY);
             logToPanel(`坐标选择: (${mainX}, ${mainY}) for "${currentSelectedTarget.name}"`);
             currentSelectedTarget.mainX = mainX; currentSelectedTarget.mainY = mainY;
             currentSelectedTarget.iframePath = null; currentSelectedTarget.iframeX = null; currentSelectedTarget.iframeY = null;
             const clickedElement = document.elementFromPoint(mainX, mainY);
             if (clickedElement && clickedElement.tagName === 'IFRAME') {
                 const iframe = clickedElement; const rect = iframe.getBoundingClientRect();
                 const iframeX = mainX - rect.left; const iframeY = mainY - rect.top;
                 try {
                     if (iframe.contentDocument || iframe.contentWindow?.document) {
                         const path = getElementPath(iframe);
                         if (path) { logToPanel(`点击于同源 Iframe (${path})`); currentSelectedTarget.iframePath = path; currentSelectedTarget.iframeX = iframeX; currentSelectedTarget.iframeY = iframeY; }
                         else { logToPanel(`无法获取 Iframe 路径。`, 'warn'); }
                     } else { logToPanel(`无法访问 Iframe 内容。`, 'warn'); }
                 } catch (e) { logToPanel(`访问 Iframe 出错: ${e.message}`, 'warn'); }
             }
             xInput.value = mainX; yInput.value = mainY;
             updateUIForSelectedTarget(); saveTargets();
             logToPanel(`目标 "${currentSelectedTarget.name}" 坐标已更新。`);
         } else { logToPanel("选择坐标时目标丢失！", "error"); }
         cancelCoordinateSelection(false);
    };
    selectBtn.addEventListener('click', () => {
        if (isSelecting || isGloballyClicking) return;
        const target = getSelectedTarget(); if (!target) { alert("请先选择或添加目标！"); return; }
        isSelecting = true; selectBtn.textContent = '点击选择...'; selectBtn.disabled = true;
        document.body.style.cursor = 'crosshair';
        const radius = target.clickRadius || 0; const diameter = Math.max(4, radius * 2);
        highlighter.style.width = `${diameter}px`; highlighter.style.height = `${diameter}px`;
        highlighter.style.display = 'block'; highlighter.style.opacity = '1';
        document.addEventListener('mousemove', mouseMoveHandler, true);
        document.addEventListener('click', selectionClickListener, true);
        document.addEventListener('contextmenu', selectionContextMenuListener, true);
    });

    // Other Listeners
    toggleLogBtn.addEventListener('click', () => { logVisible = !logVisible; logDisplayArea.style.display = logVisible ? 'block' : 'none'; toggleLogBtn.textContent = logVisible ? '隐藏日志' : '显示日志'; GM_setValue(`logVisible${STORAGE_KEY_SUFFIX}`, logVisible); if (logVisible && !isPanelCollapsed) logDisplayArea.scrollTop = logDisplayArea.scrollHeight; });
    opacitySlider.addEventListener('input', () => { panelOpacity = parseFloat(opacitySlider.value); panel.style.opacity = panelOpacity; opacityValueSpan.textContent = `${Math.round(panelOpacity * 100)}%`; });
    opacitySlider.addEventListener('change', () => { panelOpacity = parseFloat(opacitySlider.value); GM_setValue(`panelOpacity${STORAGE_KEY_SUFFIX}`, panelOpacity); });
    startBtn.addEventListener('click', startClicking);
    stopBtn.addEventListener('click', stopClicking);

    // Panel Dragging
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button') || e.target.id === 'collapse-indicator') return;
        isDragging = true; const rect = panel.getBoundingClientRect();
        offsetX = e.clientX - rect.left; offsetY = e.clientY - rect.top;
        panel.style.position = 'fixed'; panel.style.cursor = 'grabbing';
        panel.style.bottom = 'auto'; panel.style.right = 'auto';
        panel.style.left = `${e.clientX - offsetX}px`; panel.style.top = `${e.clientY - offsetY}px`;
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return; e.preventDefault();
        let newX = e.clientX - offsetX; let newY = e.clientY - offsetY;
        const maxX = window.innerWidth - panel.offsetWidth; const maxY = window.innerHeight - panel.offsetHeight;
        newX = Math.max(0, Math.min(newX, maxX)); newY = Math.max(0, Math.min(newY, maxY));
        panel.style.left = `${newX}px`; panel.style.top = `${newY}px`;
    });
    document.addEventListener('mouseup', (e) => {
        if (isDragging) { isDragging = false; panel.style.cursor = 'pointer'; panelPosition = { left: panel.style.left, top: panel.style.top }; GM_setValue(`panelPosition${STORAGE_KEY_SUFFIX}`, panelPosition); }
    });

    // --- Export Settings ---
    function exportSettings() {
        logToPanel("准备导出设置...");
        const settingsToExport = { scriptName: SCRIPT_NAME, formatVersion: EXPORT_FORMAT_VERSION, exportTimestamp: new Date().toISOString(), settings: { clickTargets, panelOpacity, logVisible, isPanelCollapsed, panelPosition } };
        try {
            const jsonString = JSON.stringify(settingsToExport, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob); const a = document.createElement('a');
            const now = new Date(); const ts = `${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
            a.href = url; a.download = `AutoClicker_${SCRIPT_VERSION}_${ts}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url); logToPanel("设置已导出。", 'info');
        } catch (error) { logToPanel(`导出错误: ${error.message}`, 'error'); console.error("Export error:", error); }
    }

    // --- Import Settings ---
    function importSettings(file) {
        if (!file) { logToPanel("未选择文件。", 'warn'); return; }
        logToPanel(`导入文件: ${file.name}...`);
        const reader = new FileReader();
        reader.onload = (event) => {
            let wasRunning = isGloballyClicking;
            try {
                const importedData = JSON.parse(event.target.result);
                if (!importedData || typeof importedData !== 'object') throw new Error("无效 JSON。");
                if (importedData.scriptName !== SCRIPT_NAME) throw new Error(`非 "${SCRIPT_NAME}" 设置文件。`);
                if (!importedData.formatVersion) throw new Error("缺少 formatVersion。");
                if (importedData.formatVersion !== EXPORT_FORMAT_VERSION) logToPanel(`警告: 文件版本 (${importedData.formatVersion}) 与脚本 (${EXPORT_FORMAT_VERSION}) 不同。`, 'warn');
                if (!importedData.settings || typeof importedData.settings !== 'object') throw new Error("缺少 'settings'。");
                if (!Array.isArray(importedData.settings.clickTargets)) throw new Error("'settings.clickTargets' 不是数组。");

                logToPanel("验证通过，应用设置...");
                clickTargets = importedData.settings.clickTargets;
                clickTargets.forEach((t, i) => { if (typeof t.id === 'undefined' || typeof t.mainX !== 'number' || typeof t.mainY !== 'number') logToPanel(`警告: 导入的目标 #${i + 1} 缺少属性。`, 'warn'); });
                panelOpacity = typeof importedData.settings.panelOpacity === 'number' ? importedData.settings.panelOpacity : 1.0;
                logVisible = typeof importedData.settings.logVisible === 'boolean' ? importedData.settings.logVisible : false;
                isPanelCollapsed = typeof importedData.settings.isPanelCollapsed === 'boolean' ? importedData.settings.isPanelCollapsed : false;
                panelPosition = typeof importedData.settings.panelPosition === 'object' && importedData.settings.panelPosition.left && importedData.settings.panelPosition.top ? importedData.settings.panelPosition : { bottom: '10px', right: '10px' };

                if (clickTargets.length === 0) {
                     logToPanel("导入文件无目标，添加默认。", 'warn');
                     const defId = Date.now(); clickTargets.push({ id: defId, name: '默认目标', mainX: 100, mainY: 100, iframePath: null, iframeX: null, iframeY: null, intervalSeconds: 5, clickRadius: 10, timeJitterPlus: 1, timeJitterMinus: 1, isActive: true });
                     selectedTargetId = defId;
                } else { selectedTargetId = clickTargets[0].id; }

                if (wasRunning) { logToPanel("导入完成，停止运行。", 'info'); stopClicking(); }

                // --- Explicitly update UI after import ---
                populateTargetSelector();     // Update dropdown first (this sets selectedTargetId if needed)
                updateGeneralUISettings();    // Update panel state (opacity, collapse, etc.)
                updateUIForSelectedTarget();  // THEN update the inputs for the newly selected target
                saveTargets(); saveOtherSettings();
                logToPanel("设置已导入并应用。", 'info');

            } catch (error) { logToPanel(`导入失败: ${error.message}`, 'error'); console.error("Import error:", error); alert(`导入失败: ${error.message}`); }
            finally { importFileInput.value = null; }
        };
        reader.onerror = (event) => { logToPanel(`读取文件出错: ${reader.error}`, 'error'); importFileInput.value = null; };
        reader.readAsText(file);
    }

    // --- Import/Export Event Listeners ---
    exportSettingsBtn.addEventListener('click', exportSettings);
    importSettingsBtn.addEventListener('click', () => { importFileInput.click(); });
    importFileInput.addEventListener('change', (event) => { if (event.target.files && event.target.files.length > 0) { importSettings(event.target.files[0]); } });

    // --- Initialization ---
    populateTargetSelector();
    updateGeneralUISettings();
    logToPanel(`坐标点击器 V${SCRIPT_VERSION} 已初始化.`);
    stopClicking(); // Ensure clean state

})();
