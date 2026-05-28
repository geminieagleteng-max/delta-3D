import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls, Sky, Line } from '@react-three/drei';
import * as THREE from 'three';
import './App.css';
import { getRank, getLeaderboard, loginAccount, registerAccount, updateNickname, updateStats, SHOP_ITEMS, purchaseItem } from './utils/account';


// ==========================================
// 0. 原生自體波形合成音效系統 (Procedural Web Audio API)
// ==========================================
class ProceduralAudio {
  constructor() {
    this.ctx = null;
    this.ambientOsc = null;
    this.ambientGain = null;
    this.ambientLfo = null;
  }

  init() {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.ctx = new AudioContextClass();
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  startAmbient() {
    this.resume();
    if (!this.ctx) return;
    if (this.ambientOsc) return;

    try {
      // 建立低沉基地背景 hum 聲
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(55, this.ctx.currentTime); // A1 55Hz
      
      // LFO 調變以產生顫音
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.setValueAtTime(0.4, this.ctx.currentTime); // 0.4Hz
      lfoGain.gain.setValueAtTime(3.0, this.ctx.currentTime); // 3Hz
      
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      
      gain.gain.setValueAtTime(0.04, this.ctx.currentTime); // 極低音量避免刺耳
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      lfo.start();
      osc.start();
      
      this.ambientOsc = osc;
      this.ambientGain = gain;
      this.ambientLfo = lfo;
    } catch (e) {
      console.warn('Failed to start ambient hum:', e);
    }
  }

  stopAmbient() {
    if (this.ambientOsc) {
      try {
        this.ambientOsc.stop();
        this.ambientLfo.stop();
      } catch (e) {}
      this.ambientOsc = null;
      this.ambientLfo = null;
    }
  }

  playGunshot() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    try {
      // 1. 擊發重低音 (Sine)
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(140, now);
      subOsc.frequency.exponentialRampToValueAtTime(55, now + 0.08);
      subGain.gain.setValueAtTime(0.8, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.15);

      // 2. 槍口爆破噪音 (Noise)
      const bufferSize = this.ctx.sampleRate * 0.35;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(120, now + 0.3);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.7, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      
      noiseNode.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      
      noiseNode.start(now);
      noiseNode.stop(now + 0.35);
    } catch (e) {
      console.warn('Gunshot sound failed:', e);
    }
  }

  playReload() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    try {
      // 模擬裝彈的三個物理步驟聲：
      // 1. 拔彈匣 (0.15s)
      this.playClick(now + 0.15, 1200, 0.25, 0.08);
      // 2. 插新彈匣 (0.75s)
      this.playClick(now + 0.75, 1000, 0.3, 0.08);
      // 3. 拉栓復位 (1.2s)
      this.playClick(now + 1.2, 1600, 0.35, 0.12);
    } catch (e) {
      console.warn('Reload sound failed:', e);
    }
  }

  playClick(time, freq, volume, duration) {
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noiseNode = this.ctx.createBufferSource();
    noiseNode.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(freq, time);
    
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(volume, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + duration - 0.01);
    
    noiseNode.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    
    noiseNode.start(time);
    noiseNode.stop(time + duration);
  }

  playPlayerHurt() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.linearRampToValueAtTime(65, now + 0.22);
      
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(140, now);
      filter.Q.setValueAtTime(3.0, now);
      
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.26);
    } catch (e) {
      console.warn('Player hurt sound failed:', e);
    }
  }

  playEnemyDeath() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.35);
      
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(280, now);
      filter.Q.setValueAtTime(2.0, now);
      
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {
      console.warn('Enemy death sound failed:', e);
    }
  }

  playExplosion() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    try {
      // 1. 重低音震波 (Sine)
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(100, now);
      subOsc.frequency.exponentialRampToValueAtTime(20, now + 0.35);
      subGain.gain.setValueAtTime(1.2, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.7);

      // 2. 爆炸崩塌破壞音 (Noise)
      const bufferSize = this.ctx.sampleRate * 0.9;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, now);
      filter.frequency.exponentialRampToValueAtTime(40, now + 0.85);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(1.0, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      
      noiseNode.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      
      noiseNode.start(now);
      noiseNode.stop(now + 0.9);
    } catch (e) {
      console.warn('Explosion sound failed:', e);
    }
  }

  playHeadshotPing() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      // 金屬敲擊音 1
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(3200, now);
      gain1.gain.setValueAtTime(0.35, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);

      // 金屬諧音 2
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(4800, now);
      gain2.gain.setValueAtTime(0.18, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.1);
    } catch (e) {
      console.warn('Headshot ping sound failed:', e);
    }
  }

  playRefillAmmo() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      this.playClick(now, 1400, 0.35, 0.08);
      this.playClick(now + 0.12, 1200, 0.4, 0.12);
    } catch (e) {
      console.warn('Refill ammo sound failed:', e);
    }
  }

  playHeal() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.42);

      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    } catch (e) {
      console.warn('Heal sound failed:', e);
    }
  }

  playSuccessChime() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.08); // A5
      gain2.gain.setValueAtTime(0.2, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.25);
    } catch (e) {
      console.warn('Success chime failed:', e);
    }
  }

  playPistolGunshot() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    try {
      // 1. 擊發重低音 (Sine) - 手槍音調偏高
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(240, now);
      subOsc.frequency.exponentialRampToValueAtTime(90, now + 0.06);
      subGain.gain.setValueAtTime(0.5, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.12);

      // 2. 槍口爆破噪音 (Noise) - 手槍較短促清脆
      const bufferSize = this.ctx.sampleRate * 0.22;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, now);
      filter.frequency.exponentialRampToValueAtTime(280, now + 0.18);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.45, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      
      noiseNode.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      
      noiseNode.start(now);
      noiseNode.stop(now + 0.22);
    } catch (e) {
      console.warn('Pistol gunshot sound failed:', e);
    }
  }

  playPistolReload() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      // 1. 拔出手槍彈匣 (0.1s)
      this.playClick(now + 0.1, 1500, 0.22, 0.06);
      // 2. 插入新手槍彈匣 (0.5s)
      this.playClick(now + 0.5, 1200, 0.28, 0.06);
      // 3. 拉動手槍滑套復位 (0.8s)
      this.playClick(now + 0.8, 1800, 0.28, 0.08);
    } catch (e) {
      console.warn('Pistol reload sound failed:', e);
    }
  }

  playWeaponSwitch() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      // 模擬機械拔槍/切換音效 (0.15s)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(250, now + 0.15);
      
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);

      // 伴隨一小聲金屬摩擦噪音
      this.playClick(now, 2200, 0.1, 0.05);
    } catch (e) {
      console.warn('Weapon switch sound failed:', e);
    }
  }
}

const soundManager = new ProceduralAudio();


// ==========================================
// 1. 鍵盤事件處理 Hook (使用 ref 以避免 60fps 渲染卡頓)
// ==========================================
function useKeyboard() {
  const keys = useRef({
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    jump: false,
    run: false,
    crouch: false,
  });

  useEffect(() => {
    const handleKeyDown = (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          keys.current.moveForward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          keys.current.moveBackward = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          keys.current.moveLeft = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          keys.current.moveRight = true;
          break;
        case 'Space':
          keys.current.jump = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          keys.current.run = true;
          break;
        case 'KeyC':
          keys.current.crouch = true;
          break;
        default:
          break;
      }
    };

    const handleKeyUp = (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          keys.current.moveForward = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          keys.current.moveBackward = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          keys.current.moveLeft = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          keys.current.moveRight = false;
          break;
        case 'Space':
          keys.current.jump = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          keys.current.run = false;
          break;
        case 'KeyC':
          keys.current.crouch = false;
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return keys;
}

// ==========================================
// 2. 敵軍 AI 生成位置與邏輯 (回歸常規 Layer 0，隨時可見)
// ==========================================
// 掩體座標常數 (在地圖沙包或木箱後方，覆蓋擴大後的地圖)
const COVERS = [
  // 核心中心與中內圈掩體
  new THREE.Vector3(0, 0, -2.5),
  new THREE.Vector3(0, 0, 2.5),
  new THREE.Vector3(-2.5, 0, 0),
  new THREE.Vector3(2.5, 0, 0),
  new THREE.Vector3(-12, 0, 0),
  new THREE.Vector3(12, 0, 0),
  new THREE.Vector3(-31, 0, -26),
  new THREE.Vector3(31, 0, 26),
  new THREE.Vector3(-31, 0, 26),
  new THREE.Vector3(31, 0, -26),
  new THREE.Vector3(-18, 0, -15),
  new THREE.Vector3(18, 0, -15),
  new THREE.Vector3(-15, 0, 18),
  new THREE.Vector3(15, 0, 18),
  // 玩家出生安全區與防護碉堡 (Z = 85 ~ 90)
  new THREE.Vector3(0, 0, 85),
  new THREE.Vector3(-3.5, 0, 89.5),
  new THREE.Vector3(3.5, 0, 89.5),
  new THREE.Vector3(0, 0, 88),
  new THREE.Vector3(-4.5, 0, 90),
  new THREE.Vector3(4.5, 0, 90),
  // 南側中後場防禦線與建築 (Z = 50 ~ 80)
  new THREE.Vector3(-30, 0, 60),
  new THREE.Vector3(30, 0, 60),
  new THREE.Vector3(-15, 0, 70),
  new THREE.Vector3(15, 0, 70),
  new THREE.Vector3(0, 0, 55),
  // 北側中前場防禦線與建築 (Z = -50 ~ -80)
  new THREE.Vector3(-30, 0, -60),
  new THREE.Vector3(30, 0, -60),
  new THREE.Vector3(-15, 0, -70),
  new THREE.Vector3(15, 0, -70),
  new THREE.Vector3(0, 0, -55),
  // 東西兩翼集裝箱與外圍戰術點 (X = ±60, ±80)
  new THREE.Vector3(-60, 0, -30),
  new THREE.Vector3(60, 0, -30),
  new THREE.Vector3(-60, 0, 30),
  new THREE.Vector3(60, 0, 30),
  new THREE.Vector3(-80, 0, 0),
  new THREE.Vector3(80, 0, 0),
  // 軍事碉堡 A 內部與掩體
  new THREE.Vector3(-45, 0, -20),
  new THREE.Vector3(-47.2, 0, -21.8),
  new THREE.Vector3(-42.8, 0, -21.8),
  // 軍事碉堡 B 內部與掩體
  new THREE.Vector3(45, 0, 20),
  new THREE.Vector3(42.8, 0, 18.2),
  new THREE.Vector3(47.2, 0, 18.2),
  // 軍事碉堡 C 內部與掩體
  new THREE.Vector3(-15, 0, -45),
  new THREE.Vector3(-17.2, 0, -46.8),
  new THREE.Vector3(-12.8, 0, -46.8),
];

const AMMO_STATION_POS = new THREE.Vector3(0, 0, -0.8);
const MED_STATION_POS = new THREE.Vector3(3.0, 0, 92.0);

const Y_PLATFORMS = [
  // Two-Story Building 1 (Center: -65, -45)
  { type: 'flat', x1: -69, x2: -61, z1: -49, z2: -41, y: 3.6 },
  { type: 'ramp', x1: -69, x2: -67, z1: -45, z2: -37, y1: 3.6, y2: 0, dir: 'z' },
  
  // Two-Story Building 2 (Center: 65, 45)
  { type: 'flat', x1: 61, x2: 69, z1: 41, z2: 49, y: 3.6 },
  { type: 'ramp', x1: 61, x2: 63, z1: 45, z2: 53, y1: 3.6, y2: 0, dir: 'z' }
];

const STATIC_COLLIDERS = [
  // 1. Guard Towers (4 corners)
  { x: -95, z: -95, hx: 1.6, hz: 1.6 },
  { x: 95, z: 95, hx: 1.6, hz: 1.6 },
  { x: -95, z: 95, hx: 1.6, hz: 1.6 },
  { x: 95, z: -95, hx: 1.6, hz: 1.6 },

  // 2. Core Center Obstacles
  // MilitaryCrates
  { x: 0, z: 0, hx: 0.72, hz: 0.72 },
  { x: 1.4, z: 0, hx: 0.65, hz: 0.65 },
  { x: -0.6, z: 1.4, hx: 0.7, hz: 0.7 },
  { x: 0.4, z: 0.4, hx: 0.54, hz: 0.54 },
  // SandbagWalls
  { x: 0, z: -3, hx: 2.0, hz: 0.225 },
  { x: 0, z: 3, hx: 2.0, hz: 0.225 },
  { x: -3, z: 0, hx: 0.225, hz: 1.6 },
  { x: 3, z: 0, hx: 0.225, hz: 1.6 },
  // ConcreteBarriers
  { x: -12, z: 0, hx: 0.6, hz: 1.8 },
  { x: 12, z: 0, hx: 0.6, hz: 1.8 },

  // 3. Middle-ground Sandbags and Crates
  { x: -28, z: -28, hx: 1.6, hz: 1.6 },
  { x: -31, z: -26, hx: 0.65, hz: 0.65 },
  { x: 28, z: 28, hx: 1.6, hz: 1.6 },
  { x: 31, z: 26, hx: 0.65, hz: 0.65 },
  { x: -28, z: 28, hx: 1.6, hz: 1.6 },
  { x: -31, z: 26, hx: 0.65, hz: 0.65 },
  { x: 28, z: -28, hx: 1.6, hz: 1.6 },
  { x: 31, z: -26, hx: 0.65, hz: 0.65 },

  { x: -15, z: -15, hx: 1.7, hz: 0.6 },
  { x: -18, z: -15, hx: 0.6, hz: 0.6 },
  { x: 15, z: -15, hx: 1.7, hz: 0.6 },
  { x: 18, z: -15, hx: 0.6, hz: 0.6 },
  { x: -15, z: 15, hx: 0.6, hz: 1.7 },
  { x: -15, z: 18, hx: 0.6, hz: 0.6 },
  { x: 15, z: 15, hx: 0.6, hz: 1.7 },
  { x: 15, z: 18, hx: 0.6, hz: 0.6 },

  // 4. Player Spawn security area (Z = 85 ~ 92)
  { x: 0, z: 85, hx: 3.0, hz: 1.2 }, // CargoContainer
  { x: 0, z: 88, hx: 2.4, hz: 0.225 }, // SandbagWall
  { x: -1.5, z: 89.5, hx: 0.6, hz: 0.6 },
  { x: 1.5, z: 89.5, hx: 0.6, hz: 0.6 },
  { x: -3.5, z: 89.5, hx: 1.8, hz: 0.5 }, // ConcreteBarrier
  { x: 3.5, z: 89.5, hx: 1.8, hz: 0.5 }, // ConcreteBarrier
  { x: -4.5, z: 90, hx: 1.6, hz: 0.9 }, // SandbagWall
  { x: -5.5, z: 91.5, hx: 0.6, hz: 0.6 },
  { x: 4.5, z: 90, hx: 1.6, hz: 0.9 }, // SandbagWall
  { x: 5.5, z: 91.5, hx: 0.6, hz: 0.6 },

  // 5. Southern mid-field Z = 50 ~ 80
  { x: -30, z: 60, hx: 1.2, hz: 3.0 }, // CargoContainer
  { x: 30, z: 60, hx: 1.2, hz: 3.0 }, // CargoContainer
  { x: -33, z: 59, hx: 0.6, hz: 0.6 },
  { x: 33, z: 59, hx: 0.6, hz: 0.6 },
  // TacticalRuins (precalculated centers and bounds)
  { x: -14.2, z: 71.97, hx: 2.1, hz: 2.1 },
  { x: 17.13, z: 69.97, hx: 2.3, hz: 2.3 },
  { x: -15, z: 72, hx: 0.6, hz: 0.6 },
  { x: 15, z: 72, hx: 0.6, hz: 0.6 },
  { x: 0, z: 55, hx: 2.0, hz: 0.225 },
  { x: 0, z: 56.5, hx: 0.6, hz: 0.6 },

  // 6. Northern mid-field Z = -50 ~ -80
  { x: -30, z: -60, hx: 1.2, hz: 3.0 }, // CargoContainer
  { x: 30, z: -60, hx: 1.2, hz: 3.0 }, // CargoContainer
  { x: -33, z: -61, hx: 0.6, hz: 0.6 },
  { x: 33, z: -61, hx: 0.6, hz: 0.6 },
  // TacticalRuins (precalculated centers and bounds)
  { x: -17.09, z: -69.67, hx: 2.3, hz: 2.3 },
  { x: 16.61, z: -71.39, hx: 1.8, hz: 1.8 },
  { x: -15, z: -72, hx: 0.6, hz: 0.6 },
  { x: 15, z: -72, hx: 0.6, hz: 0.6 },
  { x: 0, z: -55, hx: 2.0, hz: 0.225 },
  { x: 0, z: -56.5, hx: 0.6, hz: 0.6 },

  // 7. East/West flanks
  { x: -60, z: -30, hx: 3.0, hz: 1.2 }, // CargoContainer
  { x: 60, z: -30, hx: 3.0, hz: 1.2 }, // CargoContainer
  { x: -60, z: 30, hx: 3.0, hz: 1.2 }, // CargoContainer
  { x: 60, z: 30, hx: 3.0, hz: 1.2 }, // CargoContainer
  { x: -80, z: 0, hx: 2.2, hz: 1.4 }, // SandbagWall
  { x: -80, z: 1.5, hx: 0.6, hz: 0.6 },
  { x: 80, z: 0, hx: 2.2, hz: 1.4 }, // SandbagWall
  { x: 80, z: 1.5, hx: 0.6, hz: 0.6 },

  // 8. Supply Stations
  { x: 0, z: -0.8, hx: 0.7, hz: 0.5 }, // Ammo Supply Station
  { x: 3.0, z: 92.0, hx: 0.45, hz: 0.35 }, // Medical Supply Station

  // 9. Military Bunker A Walls & Interior Crates (Center: -45, -20)
  { x: -49, z: -20, hx: 0.15, hz: 3.0 }, // Left Wall
  { x: -41, z: -20, hx: 0.15, hz: 3.0 }, // Right Wall
  { x: -45, z: -23, hx: 4.0, hz: 0.15 }, // Back Wall
  { x: -47.75, z: -17, hx: 1.25, hz: 0.15 }, // Front Left Wall
  { x: -42.25, z: -17, hx: 1.25, hz: 0.15 }, // Front Right Wall
  { x: -47.2, z: -21.8, hx: 0.6, hz: 0.6 }, // Left Interior Crate
  { x: -42.8, z: -21.8, hx: 0.6, hz: 0.6 }, // Right Interior Crate

  // 10. Military Bunker B Walls & Interior Crates (Center: 45, 20)
  { x: 41, z: 20, hx: 0.15, hz: 3.0 }, // Left Wall
  { x: 49, z: 20, hx: 0.15, hz: 3.0 }, // Right Wall
  { x: 45, z: 17, hx: 4.0, hz: 0.15 }, // Back Wall
  { x: 42.25, z: 23, hx: 1.25, hz: 0.15 }, // Front Left Wall
  { x: 47.75, z: 23, hx: 1.25, hz: 0.15 }, // Front Right Wall
  { x: 42.8, z: 18.2, hx: 0.6, hz: 0.6 }, // Left Interior Crate
  { x: 47.2, z: 18.2, hx: 0.6, hz: 0.6 }, // Right Interior Crate

  // 11. Military Bunker C Walls & Interior Crates (Center: -15, -45)
  { x: -19, z: -45, hx: 0.15, hz: 3.0 }, // Left Wall
  { x: -11, z: -45, hx: 0.15, hz: 3.0 }, // Right Wall
  { x: -15, z: -48, hx: 4.0, hz: 0.15 }, // Back Wall
  { x: -17.75, z: -42, hx: 1.25, hz: 0.15 }, // Front Left Wall
  { x: -12.25, z: -42, hx: 1.25, hz: 0.15 }, // Front Right Wall
  { x: -17.2, z: -46.8, hx: 0.6, hz: 0.6 }, // Left Interior Crate
  { x: -12.8, z: -46.8, hx: 0.6, hz: 0.6 }, // Right Interior Crate

  // 12. Two-Story Building 1 (Center: -65, -45)
  { x: -65, z: -49, hx: 4.0, hz: 0.2, minY: 0, maxY: 3.6 }, // Back Wall
  { x: -69, z: -45, hx: 0.2, hz: 4.0, minY: 0, maxY: 3.6 }, // Left Wall
  { x: -61, z: -45, hx: 0.2, hz: 4.0, minY: 0, maxY: 3.6 }, // Right Wall
  { x: -67.75, z: -41, hx: 1.25, hz: 0.2, minY: 0, maxY: 3.6 }, // Front Left Wall
  { x: -62.25, z: -41, hx: 1.25, hz: 0.2, minY: 0, maxY: 3.6 }, // Front Right Wall
  { x: -69, z: -41, hx: 0.1, hz: 4.0, minY: 0, maxY: 3.6 }, // Ramp Left Rail
  { x: -67, z: -41, hx: 0.1, hz: 4.0, minY: 0, maxY: 3.6 }, // Ramp Right Rail
  { x: -65, z: -49.1, hx: 4.1, hz: 0.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Back Railing
  { x: -69.1, z: -45, hx: 0.1, hz: 4.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Left Railing
  { x: -60.9, z: -45, hx: 0.1, hz: 4.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Right Railing
  { x: -62.25, z: -40.9, hx: 1.25, hz: 0.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Front Right Rail
  { x: -65.5, z: -40.9, hx: 2.0, hz: 0.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Front Left Rail

  // 13. Two-Story Building 2 (Center: 65, 45)
  { x: 65, z: 41, hx: 4.0, hz: 0.2, minY: 0, maxY: 3.6 }, // Back Wall
  { x: 61, z: 45, hx: 0.2, hz: 4.0, minY: 0, maxY: 3.6 }, // Left Wall
  { x: 69, z: 45, hx: 0.2, hz: 4.0, minY: 0, maxY: 3.6 }, // Right Wall
  { x: 62.25, z: 49, hx: 1.25, hz: 0.2, minY: 0, maxY: 3.6 }, // Front Left Wall
  { x: 67.75, z: 49, hx: 1.25, hz: 0.2, minY: 0, maxY: 3.6 }, // Front Right Wall
  { x: 61, z: 49, hx: 0.1, hz: 4.0, minY: 0, maxY: 3.6 }, // Ramp Left Rail
  { x: 63, z: 49, hx: 0.1, hz: 4.0, minY: 0, maxY: 3.6 }, // Ramp Right Rail
  { x: 65, z: 40.9, hx: 4.1, hz: 0.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Back Railing
  { x: 60.9, z: 45, hx: 0.1, hz: 4.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Left Railing
  { x: 69.1, z: 45, hx: 0.1, hz: 4.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Right Railing
  { x: 67.75, z: 49.1, hx: 1.25, hz: 0.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Front Left Rail
  { x: 64.5, z: 49.1, hx: 2.0, hz: 0.1, minY: 3.6, maxY: 5.0 },  // 2nd Floor Front Right Rail
];

const spawnEnemies = (isTutorial = false) => {
  if (isTutorial) {
    return [
      {
        id: 101,
        position: new THREE.Vector3(0, 0, 65), // 配合玩家出生點 Z=95，將訓練靶前移至距玩家 30 米處
        hp: 100,
        state: 'alive',
        isDummy: true,
      },
      {
        id: 102,
        position: new THREE.Vector3(-6, 0, 60), // 前移至距玩家 35 米處，稍微靠左
        hp: 100,
        state: 'alive',
        isDummy: true,
      }
    ];
  }

  const count = 12;
  const spawned = [];
  
  for (let i = 0; i < count; i++) {
    const isSniper = false; // 移除角落哨塔狙擊手，全部改為普通地面步兵
    // 隨機在更大範圍內生成地面步兵，擴大隨機出生範圍至 -90 ~ 90 (與地圖擴大同步)
    let x = (Math.random() - 0.5) * 180;
    let z = (Math.random() - 0.5) * 180;
    // 與南側邊緣玩家出生點 (0, 1.6, 95) 的安全距離拉大為 45 米，防範出生即遭擊中
    while (Math.sqrt(x * x + (z - 95) * (z - 95)) < 45) {
      x = (Math.random() - 0.5) * 180;
      z = (Math.random() - 0.5) * 180;
    }
    const pos = new THREE.Vector3(x, 0, z);

    spawned.push({
      id: i + 1,
      position: pos,
      hp: 100,
      state: 'alive',
      isSniper,
    });
  }
  return spawned;
};

// 彈道紅色雷射軌跡線
function TracerLine({ start, end }) {
  return (
    <Line
      points={[start, end]}
      color="#ff3b3b"
      lineWidth={2.0}
      transparent
      opacity={0.8}
    />
  );
}

// 敵軍血量條 (面朝相機看板 Billboard)
function EnemyHealthBar({ hp }) {
  const percent = Math.max(0, hp / 100);
  return (
    <group position={[0, 2.3, 0]}>
      <mesh>
        <planeGeometry args={[1.0, 0.08]} />
        <meshBasicMaterial color="#333333" doubleSide />
      </mesh>
      {percent > 0 && (
        <mesh position={[-(1 - percent) * 0.5, 0, 0.005]}>
          <planeGeometry args={[percent, 0.06]} />
          <meshBasicMaterial color="#00ff66" doubleSide />
        </mesh>
      )}
    </group>
  );
}

// 敵軍 AI 組件
function Enemy({ data, onShootPlayer, onKilled }) {
  const meshRef = useRef();
  const healthBarRef = useRef();
  const [dyingRotation, setDyingRotation] = useState(0);
  const lastShotTime = useRef(0);

  // 敵軍開火紅色射線狀態
  const [tracerVisible, setTracerVisible] = useState(false);
  const [tracerCoords, setTracerCoords] = useState({ start: [0, 0, 0], end: [0, 0, 0] });

  // 掩體尋求 AI 狀態變數
  const currentTarget = useRef(new THREE.Vector3());
  const coverTimer = useRef(0);
  const aiState = useRef('movingToCover'); // 'movingToCover', 'shootingFromCover', 'rushing'

  // 初始化尋求的掩體 (步兵) - 改為尋求離自身最近的掩體，避免所有人塞到同一個點
  useEffect(() => {
    if (!data.isSniper) {
      const enemyPos = data.position;
      
      let closest = COVERS[0];
      let minDist = closest.distanceTo(enemyPos);
      for (let i = 1; i < COVERS.length; i++) {
        const d = COVERS[i].distanceTo(enemyPos);
        if (d < minDist) {
          minDist = d;
          closest = COVERS[i];
        }
      }
      currentTarget.current.copy(closest);
    }
  }, [data.isSniper, data.position]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    if (data.state === 'dying') {
      if (dyingRotation < Math.PI / 2) {
        const speed = 4.5;
        const newRot = Math.min(Math.PI / 2, dyingRotation + delta * speed);
        setDyingRotation(newRot);
        meshRef.current.rotation.z = newRot;
      } else {
        onKilled(data.id);
      }
      return;
    }

    const enemyPos = meshRef.current.position;
    const playerPos = state.camera.position;

    // 隨時面朝玩家
    const angle = Math.atan2(playerPos.x - enemyPos.x, playerPos.z - enemyPos.z);
    meshRef.current.rotation.y = angle;

    if (healthBarRef.current) {
      healthBarRef.current.lookAt(state.camera.position);
    }

    const distToPlayer = enemyPos.distanceTo(playerPos);

    if (data.isSniper) {
      // 哨塔狙擊手 AI：留在平台不移動，冷卻時間較長 (3.0s - 4.5s)，單發傷害 20 HP
      const MAX_SNIPER_RANGE = 160.0; // 狙擊手最遠射擊範圍：160 米
      if (distToPlayer <= MAX_SNIPER_RANGE) {
        const now = state.clock.getElapsedTime();
        const cooldown = 3.0 + Math.random() * 1.5;
        if (now - lastShotTime.current > cooldown) {
          lastShotTime.current = now;

          // 視線遮擋射線檢查 (Line of Sight Raycast)
          const raycastStart = new THREE.Vector3(0, 1.5, 0).add(enemyPos);
          const endPos = playerPos.clone().add(new THREE.Vector3(0, -0.2, 0));
          const direction = new THREE.Vector3().subVectors(endPos, raycastStart);
          const distToPlayerLen = direction.length();
          direction.normalize();

          const raycaster = new THREE.Raycaster(raycastStart, direction, 0, distToPlayerLen);
          const intersects = raycaster.intersectObjects(state.scene.children, true);
          
          let blocked = false;
          for (let i = 0; i < intersects.length; i++) {
            const hit = intersects[i];
            if (hit.distance < 0.8) continue; // 忽略射擊者自身

            let parent = hit.object;
            let isSelfOrEnemy = false;
            let isCosmetic = false;
            while (parent) {
              if (parent.userData && (parent.userData.isEnemy || parent.userData.isDummy)) {
                isSelfOrEnemy = true;
                break;
              }
              if (parent.name === 'weapon' || parent.name === 'player' || parent.name === 'bullet_hole' || parent.name === 'tracer' || parent.name === 'casing' || parent.name === 'magazine') {
                isCosmetic = true;
                break;
              }
              parent = parent.parent;
            }
            if (isSelfOrEnemy || isCosmetic) continue;

            // 若在中途擊中任何實體掩體(如沙包、貨櫃、混凝土板)，即判定視線阻擋
            if (hit.distance < distToPlayerLen - 0.5) {
              blocked = true;
              break;
            }
          }

          if (!blocked) {
            onShootPlayer(20); // 扣 20 HP

            const startPos = new THREE.Vector3(0.25, 1.1, 1.0).applyMatrix4(meshRef.current.matrixWorld);
            setTracerCoords({
              start: [startPos.x, startPos.y, startPos.z],
              end: [endPos.x, endPos.y, endPos.z],
            });
            setTracerVisible(true);
            setTimeout(() => setTracerVisible(false), 90);
          }
        }
      }
    } else {
      // 地面步兵 AI：掩體跳躍與衝鋒邏輯
      if (aiState.current === 'movingToCover') {
        const distToCover = enemyPos.distanceTo(currentTarget.current);
        if (distToCover > 0.5) {
          const dir = new THREE.Vector3().subVectors(currentTarget.current, enemyPos);
          dir.y = 0;
          dir.normalize();
          enemyPos.addScaledVector(dir, 2.0 * delta);
          meshRef.current.position.y = Math.abs(Math.sin(state.clock.getElapsedTime() * 8.5)) * 0.12;
        } else {
          aiState.current = 'shootingFromCover';
          coverTimer.current = 4.0 + Math.random() * 3.0; // 停留射擊 4-7 秒
        }
      } else if (aiState.current === 'shootingFromCover') {
        meshRef.current.position.y = 0;
        coverTimer.current -= delta;
        if (coverTimer.current <= 0) {
          if (distToPlayer > 18) {
            // 尋找下一個距離玩家更近的掩體
            let bestCover = currentTarget.current;
            let bestDist = bestCover.distanceTo(playerPos);
            for (let i = 0; i < COVERS.length; i++) {
              const dToPlayer = COVERS[i].distanceTo(playerPos);
              const dToEnemy = COVERS[i].distanceTo(enemyPos);
              // 擴大地圖後，將尋求新掩體的最大搜索範圍由 25 米調大至 60 米，避免大縱深間隔中斷尋路
              if (dToPlayer < distToPlayer && dToEnemy < 60) {
                if (dToPlayer < bestDist) {
                  bestDist = dToPlayer;
                  bestCover = COVERS[i];
                }
              }
            }
            currentTarget.current.copy(bestCover);
            aiState.current = 'movingToCover';
          } else {
            // 距離已近，開始無掩體衝鋒
            aiState.current = 'rushing';
          }
        }
      } else {
        // 衝鋒狀態：速度加快 (2.5m/s) 直撲玩家
        if (distToPlayer > 8) {
          const dir = new THREE.Vector3().subVectors(playerPos, enemyPos);
          dir.y = 0;
          dir.normalize();
          enemyPos.addScaledVector(dir, 2.5 * delta);
          meshRef.current.position.y = Math.abs(Math.sin(state.clock.getElapsedTime() * 10.5)) * 0.14;
        } else {
          meshRef.current.position.y = 0;
        }
      }

      // 地面步兵開火判定 (傷害 10 HP，冷卻 2.0s - 2.7s)
      const MAX_INFANTRY_RANGE = 75.0; // 地面普通步兵最遠射擊範圍：75 米
      if (distToPlayer <= MAX_INFANTRY_RANGE) {
        const now = state.clock.getElapsedTime();
        const cooldown = 2.0 + Math.random() * 0.7;
        if (now - lastShotTime.current > cooldown) {
          lastShotTime.current = now;

          // 視線遮擋射線檢查 (Line of Sight Raycast)
          const raycastStart = new THREE.Vector3(0, 1.5, 0).add(enemyPos);
          const endPos = playerPos.clone().add(new THREE.Vector3(0, -0.2, 0));
          const direction = new THREE.Vector3().subVectors(endPos, raycastStart);
          const distToPlayerLen = direction.length();
          direction.normalize();

          const raycaster = new THREE.Raycaster(raycastStart, direction, 0, distToPlayerLen);
          const intersects = raycaster.intersectObjects(state.scene.children, true);
          
          let blocked = false;
          for (let i = 0; i < intersects.length; i++) {
            const hit = intersects[i];
            if (hit.distance < 0.8) continue; // 忽略射擊者自身

            let parent = hit.object;
            let isSelfOrEnemy = false;
            let isCosmetic = false;
            while (parent) {
              if (parent.userData && (parent.userData.isEnemy || parent.userData.isDummy)) {
                isSelfOrEnemy = true;
                break;
              }
              if (parent.name === 'weapon' || parent.name === 'player' || parent.name === 'bullet_hole' || parent.name === 'tracer' || parent.name === 'casing' || parent.name === 'magazine') {
                isCosmetic = true;
                break;
              }
              parent = parent.parent;
            }
            if (isSelfOrEnemy || isCosmetic) continue;

            // 若在中途擊中任何實體掩體(如沙包、貨櫃、混凝土板)，即判定視線阻擋
            if (hit.distance < distToPlayerLen - 0.5) {
              blocked = true;
              break;
            }
          }

          if (!blocked) {
            // AI 命中機率判定 (例如 38% 命中率，防範每發皆中)
            const isHit = Math.random() < 0.38;
            
            const startPos = new THREE.Vector3(0.25, 1.1, 0.7).applyMatrix4(meshRef.current.matrixWorld);
            let targetCoords = endPos.clone();
            
            if (isHit) {
              onShootPlayer(10); // 命中扣 10 HP
            } else {
              // 未命中：隨機偏移 1.5 到 3.5 米以描繪擦肩而過的子彈雷射效果
              const offset = new THREE.Vector3(
                (Math.random() - 0.5) * 4.0,
                (Math.random() - 0.5) * 2.0,
                (Math.random() - 0.5) * 4.0
              );
              targetCoords.add(offset);
            }

            setTracerCoords({
              start: [startPos.x, startPos.y, startPos.z],
              end: [targetCoords.x, targetCoords.y, targetCoords.z],
            });
            setTracerVisible(true);
            setTimeout(() => setTracerVisible(false), 90);
          }
        }
      }
      // 限制敵軍在圍牆邊界內
      enemyPos.x = Math.max(-118, Math.min(118, enemyPos.x));
      enemyPos.z = Math.max(-118, Math.min(118, enemyPos.z));

       // 敵軍碰撞檢測 (避免穿牆)
      const enemyRadius = 0.35;
      for (let i = 0; i < STATIC_COLLIDERS.length; i++) {
        const c = STATIC_COLLIDERS[i];
        const minX = c.x - c.hx - enemyRadius;
        const maxX = c.x + c.hx + enemyRadius;
        const minZ = c.z - c.hz - enemyRadius;
        const maxZ = c.z + c.hz + enemyRadius;

        const enemyFeetY = enemyPos.y;
        const enemyHeadY = enemyPos.y + 1.8;
        const minY = c.minY !== undefined ? c.minY : 0;
        const maxY = c.maxY !== undefined ? c.maxY : Infinity;
        const yOverlap = enemyHeadY >= minY && enemyFeetY <= maxY;

        if (yOverlap &&
            enemyPos.x > minX && enemyPos.x < maxX &&
            enemyPos.z > minZ && enemyPos.z < maxZ) {
          const distLeft = enemyPos.x - minX;
          const distRight = maxX - enemyPos.x;
          const distBottom = enemyPos.z - minZ;
          const distTop = maxZ - enemyPos.z;

          const minDist = Math.min(distLeft, distRight, distBottom, distTop);
          if (minDist === distLeft) {
            enemyPos.x = minX;
          } else if (minDist === distRight) {
            enemyPos.x = maxX;
          } else if (minDist === distBottom) {
            enemyPos.z = minZ;
          } else {
            enemyPos.z = maxZ;
          }
        }
      }
    }
  });

  return (
    <group
      position={[data.position.x, data.position.y, data.position.z]}
      ref={meshRef}
      userData={{ isEnemy: true, enemyId: data.id }}
    >
      {/* 敵軍主體：狙擊手為藍色迷彩裝，普通兵為紅色 */}
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.35, 1.4, 8]} />
        <meshStandardMaterial color={data.isSniper ? "#253b59" : "#aa2222"} roughness={0.7} flatShading />
      </mesh>

      {/* 敵軍頭部 */}
      <mesh position={[0, 1.8, 0]} castShadow>
        <sphereGeometry args={[0.26, 8, 8]} />
        <meshStandardMaterial color="#e0a890" roughness={0.8} />
      </mesh>

      {/* 戰術迷彩頭盔 */}
      <mesh position={[0, 1.9, 0]} castShadow>
        <sphereGeometry args={[0.28, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={data.isSniper ? "#343a40" : "#554b38"} roughness={0.9} />
      </mesh>

      {/* 敵軍武器：狙擊手配備長槍管 */}
      <group position={[0.25, 1.1, 0.3]} rotation={[0, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.08, 0.08, data.isSniper ? 1.4 : 0.8]} />
          <meshStandardMaterial color={data.isSniper ? "#5a6268" : "#111111"} metalness={data.isSniper ? 0.7 : 0.1} />
        </mesh>
      </group>

      <group ref={healthBarRef}>
        <EnemyHealthBar hp={data.hp} />
      </group>

      {tracerVisible && (
        <TracerLine start={tracerCoords.start} end={tracerCoords.end} />
      )}
    </group>
  );
}

// ==========================================
// 2.1 訓練標靶組件 (Training Dummy)
// ==========================================
function TrainingDummy({ data, onKilled }) {
  const meshRef = useRef();
  const healthBarRef = useRef();
  const [dyingRotation, setDyingRotation] = useState(0);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    if (data.state === 'dying') {
      if (dyingRotation < Math.PI / 2) {
        const speed = 4.5;
        const newRot = Math.min(Math.PI / 2, dyingRotation + delta * speed);
        setDyingRotation(newRot);
        meshRef.current.rotation.z = newRot;
      } else {
        onKilled(data.id);
      }
      return;
    }

    // 緩慢原地旋轉
    meshRef.current.rotation.y = state.clock.getElapsedTime() * 0.5;

    if (healthBarRef.current) {
      healthBarRef.current.lookAt(state.camera.position);
    }
  });

  return (
    <group
      position={[data.position.x, data.position.y, data.position.z]}
      ref={meshRef}
      userData={{ isEnemy: true, enemyId: data.id }}
    >
      {/* 標靶底座 */}
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.1, 8]} />
        <meshStandardMaterial color="#2d2d2d" roughness={0.9} />
      </mesh>

      {/* 標靶支架 */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 0.8, 8]} />
        <meshStandardMaterial color="#444444" roughness={0.8} />
      </mesh>

      {/* 標靶主體 (紅白相間同心圓) */}
      <group position={[0, 1.25, 0]}>
        {/* 外圈 */}
        <mesh castShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.1, 16]} rotation={[Math.PI / 2, 0, 0]} />
          <meshStandardMaterial color="#cc1111" roughness={0.7} />
        </mesh>
        {/* 中圈 */}
        <mesh position={[0, 0, 0.052]} castShadow>
          <cylinderGeometry args={[0.26, 0.26, 0.01, 16]} rotation={[Math.PI / 2, 0, 0]} />
          <meshStandardMaterial color="#ffffff" roughness={0.7} />
        </mesh>
        {/* 內圈 */}
        <mesh position={[0, 0, 0.058]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.01, 16]} rotation={[Math.PI / 2, 0, 0]} />
          <meshStandardMaterial color="#cc1111" roughness={0.7} />
        </mesh>
      </group>

      {/* 訓練靶頭部 (用於爆頭判定) */}
      <mesh position={[0, 1.8, 0]} castShadow>
        <sphereGeometry args={[0.22, 10, 10]} />
        <meshStandardMaterial color="#eeaa00" roughness={0.6} />
      </mesh>

      <group ref={healthBarRef}>
        <EnemyHealthBar hp={data.hp} />
      </group>
    </group>
  );
}

// ==========================================
// 3. 3D 場景資產組件 (低多邊形 Low-Poly 風格)
// ==========================================
function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[250, 250]} />
        <meshStandardMaterial color="#2d3527" roughness={0.9} />
      </mesh>
      <gridHelper args={[240, 120, '#00ff66', '#142517']} position={[0, 0.01, 0]} />
    </group>
  );
}

function PerimeterWalls() {
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: '#1a1f18',
    roughness: 0.9,
    flatShading: true,
  });

  return (
    <group>
      <mesh position={[0, 4, -120]} material={wallMaterial} castShadow receiveShadow>
        <boxGeometry args={[240, 8, 2]} />
      </mesh>
      <mesh position={[0, 4, 120]} material={wallMaterial} castShadow receiveShadow>
        <boxGeometry args={[240, 8, 2]} />
      </mesh>
      <mesh position={[120, 4, 0]} rotation={[0, Math.PI / 2, 0]} material={wallMaterial} castShadow receiveShadow>
        <boxGeometry args={[240, 8, 2]} />
      </mesh>
      <mesh position={[-120, 4, 0]} rotation={[0, Math.PI / 2, 0]} material={wallMaterial} castShadow receiveShadow>
        <boxGeometry args={[240, 8, 2]} />
      </mesh>
    </group>
  );
}

function MilitaryCrate({ position, rotation = [0, 0, 0], scale = [1, 1, 1] }) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.2, 1.2, 1.2]} />
        <meshStandardMaterial color="#3d4c38" roughness={0.8} flatShading />
      </mesh>
      <mesh position={[0, 0, 0.605]} castShadow>
        <boxGeometry args={[1.0, 0.1, 0.02]} />
        <meshStandardMaterial color="#242e22" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.605]} rotation={[0, 0, Math.PI / 4]} castShadow>
        <boxGeometry args={[1.2, 0.08, 0.02]} />
        <meshStandardMaterial color="#242e22" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, -0.605]} castShadow>
        <boxGeometry args={[1.0, 0.1, 0.02]} />
        <meshStandardMaterial color="#242e22" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, -0.605]} rotation={[0, 0, -Math.PI / 4]} castShadow>
        <boxGeometry args={[1.2, 0.08, 0.02]} />
        <meshStandardMaterial color="#242e22" roughness={0.9} />
      </mesh>
      <mesh position={[0.605, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.9, 0.9, 0.02]} />
        <meshStandardMaterial color="#2d3829" roughness={0.9} />
      </mesh>
      <mesh position={[-0.605, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.9, 0.9, 0.02]} />
        <meshStandardMaterial color="#2d3829" roughness={0.9} />
      </mesh>
    </group>
  );
}

// 混凝土防撞牆 (高 2.4 米, 寬 3.6 米, 厚 0.4 米)
function ConcreteBarrier({ position, rotation = [0, 0, 0], scale = [1, 1, 1] }) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* 主混凝土板 */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[3.6, 2.4, 0.4]} />
        <meshStandardMaterial color="#5a5e5b" roughness={0.9} flatShading />
      </mesh>
      {/* 底座支撐 */}
      <mesh position={[-1.4, -1.0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.6, 0.4, 1.2]} />
        <meshStandardMaterial color="#454846" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[1.4, -1.0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.6, 0.4, 1.2]} />
        <meshStandardMaterial color="#454846" roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

// 戰術軍用貨櫃 (高 2.6 米, 寬 2.4 米, 長 6.0 米)
function CargoContainer({ position, rotation = [0, 0, 0], color = "#4b5945" }) {
  return (
    <group position={position}>
      <group rotation={rotation}>
        {/* 集裝箱本體 */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.4, 2.6, 6.0]} />
          <meshStandardMaterial color={color} roughness={0.75} metalness={0.25} flatShading />
        </mesh>
        {/* 集裝箱條紋裝飾 (前後框) */}
        <mesh position={[0, 0, 3.01]} castShadow>
          <boxGeometry args={[2.42, 2.62, 0.05]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0, -3.01]} castShadow>
          <boxGeometry args={[2.42, 2.62, 0.05]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
        </mesh>
        {/* 集裝箱側邊凸起紋路 */}
        <mesh position={[1.21, 0, 0]} castShadow>
          <boxGeometry args={[0.02, 2.4, 5.6]} />
          <meshStandardMaterial color="#2d2d2d" roughness={0.8} />
        </mesh>
        <mesh position={[-1.21, 0, 0]} castShadow>
          <boxGeometry args={[0.02, 2.4, 5.6]} />
          <meshStandardMaterial color="#2d2d2d" roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

// L型戰術斷垣殘壁 (高 3.2 米, 寬 3.0 米, 厚 0.3 米)
function TacticalRuin({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position}>
      <group rotation={rotation}>
        {/* L型牆1 (X軸方向) */}
        <mesh position={[1.5, 1.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.0, 3.2, 0.3]} />
          <meshStandardMaterial color="#6e6c64" roughness={0.9} flatShading />
        </mesh>
        {/* L型牆2 (Z軸方向) */}
        <mesh position={[0, 1.6, 1.5]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.0, 3.2, 0.3]} />
          <meshStandardMaterial color="#6e6c64" roughness={0.9} flatShading />
        </mesh>
        {/* 碎磚塊裝飾 */}
        <mesh position={[0, 3.1, 0.2]} rotation={[0.4, 0.3, 0.5]} castShadow>
          <boxGeometry args={[0.6, 0.4, 0.4]} />
          <meshStandardMaterial color="#55534e" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

function SandbagWall({ position, rotation = [0, 0, 0], length = 4 }) {
  const sandbags = [];
  const heightLevels = 3;
  const bagWidth = 0.8;
  const bagHeight = 0.22;
  const bagThickness = 0.45;

  for (let level = 0; level < heightLevels; level++) {
    const isEven = level % 2 === 0;
    const count = isEven ? length : length - 1;
    const offset = isEven ? 0 : bagWidth / 2;

    for (let i = 0; i < count; i++) {
      const posX = i * bagWidth - (length - 1) * (bagWidth / 2) + offset;
      const posY = level * bagHeight + bagHeight / 2;
      sandbags.push(
        <mesh key={`${level}-${i}`} position={[posX, posY, 0]} castShadow receiveShadow>
          <boxGeometry args={[bagWidth - 0.05, bagHeight - 0.02, bagThickness]} />
          <meshStandardMaterial color="#8b7b63" roughness={0.95} flatShading />
        </mesh>
      );
    }
  }

  return (
    <group position={position} rotation={rotation}>
      {sandbags}
    </group>
  );
}

function GuardTower({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 4.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 0.25, 3.2]} />
        <meshStandardMaterial color="#424242" roughness={0.7} />
      </mesh>

      <mesh position={[-1.4, 2.1, -1.4]} castShadow>
        <boxGeometry args={[0.16, 4.2, 0.16]} />
        <meshStandardMaterial color="#1e1e1e" roughness={0.9} />
      </mesh>
      <mesh position={[1.4, 2.1, -1.4]} castShadow>
        <boxGeometry args={[0.16, 4.2, 0.16]} />
        <meshStandardMaterial color="#1e1e1e" roughness={0.9} />
      </mesh>
      <mesh position={[-1.4, 2.1, 1.4]} castShadow>
        <boxGeometry args={[0.16, 4.2, 0.16]} />
        <meshStandardMaterial color="#1e1e1e" roughness={0.9} />
      </mesh>
      <mesh position={[1.4, 2.1, 1.4]} castShadow>
        <boxGeometry args={[0.16, 4.2, 0.16]} />
        <meshStandardMaterial color="#1e1e1e" roughness={0.9} />
      </mesh>

      <mesh position={[0, 2.1, -1.4]} rotation={[0, 0, Math.PI / 4]} castShadow>
        <boxGeometry args={[0.06, 4.8, 0.05]} />
        <meshStandardMaterial color="#141414" />
      </mesh>
      <mesh position={[0, 2.1, -1.4]} rotation={[0, 0, -Math.PI / 4]} castShadow>
        <boxGeometry args={[0.06, 4.8, 0.05]} />
        <meshStandardMaterial color="#141414" />
      </mesh>
      <mesh position={[0, 2.1, 1.4]} rotation={[0, 0, Math.PI / 4]} castShadow>
        <boxGeometry args={[0.06, 4.8, 0.05]} />
        <meshStandardMaterial color="#141414" />
      </mesh>
      <mesh position={[0, 2.1, 1.4]} rotation={[0, 0, -Math.PI / 4]} castShadow>
        <boxGeometry args={[0.06, 4.8, 0.05]} />
        <meshStandardMaterial color="#141414" />
      </mesh>

      <mesh position={[0, 4.8, -1.5]} castShadow>
        <boxGeometry args={[3.2, 0.8, 0.08]} />
        <meshStandardMaterial color="#2d2d2d" />
      </mesh>
      <mesh position={[-1.5, 4.8, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[3.2, 0.8, 0.08]} />
        <meshStandardMaterial color="#2d2d2d" />
      </mesh>
      <mesh position={[1.5, 4.8, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[3.2, 0.8, 0.08]} />
        <meshStandardMaterial color="#2d2d2d" />
      </mesh>

      <group position={[0, 2.1, 1.45]}>
        {Array.from({ length: 9 }).map((_, i) => (
          <mesh key={i} position={[0, -1.8 + i * 0.45, 0]} castShadow>
            <boxGeometry args={[0.6, 0.04, 0.04]} />
            <meshStandardMaterial color="#222" />
          </mesh>
        ))}
      </group>

      <mesh position={[-1.4, 5.4, -1.4]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 2.2]} />
        <meshStandardMaterial color="#1e1e1e" />
      </mesh>
      <mesh position={[1.4, 5.4, -1.4]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 2.2]} />
        <meshStandardMaterial color="#1e1e1e" />
      </mesh>
      <mesh position={[-1.4, 5.4, 1.4]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 2.2]} />
        <meshStandardMaterial color="#1e1e1e" />
      </mesh>
      <mesh position={[1.4, 5.4, 1.4]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 2.2]} />
        <meshStandardMaterial color="#1e1e1e" />
      </mesh>

      <mesh position={[0, 6.6, 0]} castShadow receiveShadow>
        <coneGeometry args={[2.7, 1.0, 4]} />
        <meshStandardMaterial color="#51392b" roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

// 戰術軍事碉堡 (高 3.5 米, 寬 8.0 米, 深 6.0 米, 中空可進入)
function MilitaryBunker({ position, rotation = [0, 0, 0] }) {
  const wallMat = new THREE.MeshStandardMaterial({
    color: '#656b68',
    roughness: 0.85,
    flatShading: true,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: '#2a2e2b',
    roughness: 0.9,
  });

  return (
    <group position={position} rotation={rotation}>
      {/* 左外牆 */}
      <mesh position={[-4, 1.75, 0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[0.3, 3.5, 6.0]} />
      </mesh>

      {/* 右外牆 */}
      <mesh position={[4, 1.75, 0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[0.3, 3.5, 6.0]} />
      </mesh>

      {/* 後外牆 */}
      <mesh position={[0, 1.75, -3.0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[8.0, 3.5, 0.3]} />
      </mesh>

      {/* 正面左牆 */}
      <mesh position={[-2.75, 1.75, 3.0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[2.5, 3.5, 0.3]} />
      </mesh>

      {/* 正面右牆 */}
      <mesh position={[2.75, 1.75, 3.0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[2.5, 3.5, 0.3]} />
      </mesh>

      {/* 正面大門上方橫樑 */}
      <mesh position={[0, 3.0, 3.0]} material={trimMat} castShadow receiveShadow>
        <boxGeometry args={[3.0, 1.0, 0.3]} />
      </mesh>

      {/* 碉堡屋頂 (天花板) */}
      <mesh position={[0, 3.6, 0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[8.4, 0.2, 6.4]} />
      </mesh>

      {/* 屋頂飾條 */}
      <mesh position={[0, 3.75, 0]} material={trimMat} castShadow>
        <boxGeometry args={[8.5, 0.1, 0.1]} />
      </mesh>
      
      {/* 碉堡內部裝飾箱子 (供玩家或AI在碉堡內作為掩體) */}
      <MilitaryCrate position={[-2.2, 0.6, -1.8]} rotation={[0, 0.3, 0]} />
      <MilitaryCrate position={[2.2, 0.6, -1.8]} rotation={[0, -0.2, 0]} />
    </group>
  );
}

// 全新雙層大型軍事建築 (高 3.6 米, 寬 8.0 米, 深 8.0 米, 包含爬坡鋼梯、二樓平台、科幻發光立柱)
function TwoStoryBuilding({ position }) {
  const wallMat = new THREE.MeshStandardMaterial({
    color: '#4e5357', // 混凝土灰
    roughness: 0.85,
    flatShading: true,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: '#1a1f24', // 深色金屬飾條
    roughness: 0.9,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: '#2a3038', // 鋼製爬坡梯顏色
    roughness: 0.5,
    metalness: 0.8,
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: '#1f2429', // 護欄暗色鋼材
    roughness: 0.7,
  });

  return (
    <group position={position}>
      {/* ================= 1. 一樓牆面與門廊 (高度: 0 ~ 3.6 米) ================= */}
      {/* 後外牆 */}
      <mesh position={[0, 1.8, -4.0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[8.0, 3.6, 0.3]} />
      </mesh>
      {/* 左外牆 */}
      <mesh position={[-4.0, 1.8, 0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[0.3, 3.6, 8.0]} />
      </mesh>
      {/* 右外牆 */}
      <mesh position={[4.0, 1.8, 0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[0.3, 3.6, 8.0]} />
      </mesh>
      {/* 正面左牆 */}
      <mesh position={[-2.75, 1.8, 4.0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[2.5, 3.6, 0.3]} />
      </mesh>
      {/* 正面右牆 */}
      <mesh position={[2.75, 1.8, 4.0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[2.5, 3.6, 0.3]} />
      </mesh>
      {/* 正面門楣上方橫樑 */}
      <mesh position={[0, 3.1, 4.0]} material={trimMat} castShadow receiveShadow>
        <boxGeometry args={[3.0, 1.0, 0.3]} />
      </mesh>

      {/* ================= 2. 二樓地板平台 (高度 Y: 3.6 米) ================= */}
      <mesh position={[0, 3.6, 0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[8.4, 0.2, 8.4]} />
      </mesh>
      {/* 二樓地板邊框飾板 */}
      <mesh position={[0, 3.6, 4.21]} material={trimMat} castShadow>
        <boxGeometry args={[8.4, 0.3, 0.05]} />
      </mesh>
      <mesh position={[0, 3.6, -4.21]} material={trimMat} castShadow>
        <boxGeometry args={[8.4, 0.3, 0.05]} />
      </mesh>
      <mesh position={[4.21, 3.6, 0]} material={trimMat} castShadow>
        <boxGeometry args={[0.05, 0.3, 8.4]} />
      </mesh>
      <mesh position={[-4.21, 3.6, 0]} material={trimMat} castShadow>
        <boxGeometry args={[0.05, 0.3, 8.4]} />
      </mesh>

      {/* ================= 3. 鋼製爬坡梯/斜坡 (Z 軸 +8 到 0 米, X 軸 -3 米) ================= */}
      {/* 坡度夾角 Math.atan2(3.6, 8.0) = 0.422 弧度, 斜度長度 8.77 米 */}
      <group position={[-3.0, 1.8, 4.0]} rotation={[-Math.atan2(3.6, 8.0), 0, 0]}>
        {/* 斜面鋼板底座 */}
        <mesh material={steelMat} castShadow receiveShadow>
          <boxGeometry args={[2.0, 0.08, 8.77]} />
        </mesh>
        
        {/* 防滑梯級裝飾 */}
        {Array.from({ length: 12 }).map((_, i) => (
          <mesh key={i} position={[0, 0.06, -4.0 + i * 0.73]} material={trimMat} castShadow>
            <boxGeometry args={[2.0, 0.04, 0.15]} />
          </mesh>
        ))}

        {/* 斜坡左側安全護欄 */}
        <mesh position={[-0.95, 0.5, 0]} material={railMat} castShadow>
          <boxGeometry args={[0.06, 1.0, 8.77]} />
        </mesh>
        {/* 斜坡右側安全護欄 */}
        <mesh position={[0.95, 0.5, 0]} material={railMat} castShadow>
          <boxGeometry args={[0.06, 1.0, 8.77]} />
        </mesh>
        
        {/* 斜坡立柱裝飾 */}
        {Array.from({ length: 4 }).map((_, i) => (
          <group key={i} position={[0, 0.25, -3.5 + i * 2.3]}>
            <mesh position={[-0.95, 0, 0]} material={railMat} castShadow>
              <boxGeometry args={[0.04, 0.5, 0.04]} />
            </mesh>
            <mesh position={[0.95, 0, 0]} material={railMat} castShadow>
              <boxGeometry args={[0.04, 0.5, 0.04]} />
            </mesh>
          </group>
        ))}
      </group>

      {/* ================= 4. 二樓安全防護鋼製欄杆 (高度 Y: 3.6 ~ 4.8 米) ================= */}
      {/* 後方防護護欄 */}
      <mesh position={[0, 4.2, -4.1]} material={railMat} castShadow>
        <boxGeometry args={[8.2, 1.2, 0.06]} />
      </mesh>
      {/* 左側防護護欄 */}
      <mesh position={[-4.1, 4.2, 0]} material={railMat} castShadow>
        <boxGeometry args={[0.06, 1.2, 8.2]} />
      </mesh>
      {/* 右側防護護欄 */}
      <mesh position={[4.1, 4.2, 0]} material={railMat} castShadow>
        <boxGeometry args={[0.06, 1.2, 8.2]} />
      </mesh>
      {/* 正面右側護欄 */}
      <mesh position={[2.75, 4.2, 4.1]} material={railMat} castShadow>
        <boxGeometry args={[2.5, 1.2, 0.06]} />
      </mesh>
      {/* 正面左側與中央護欄 (預留出 X: -4 到 -2 的斜坡出口通道) */}
      <mesh position={[-0.25, 4.2, 4.1]} material={railMat} castShadow>
        <boxGeometry args={[3.5, 1.2, 0.06]} />
      </mesh>

      {/* 護欄粗型角鐵立柱 */}
      <group position={[0, 4.2, 0]}>
        <mesh position={[-4.0, 0, -4.0]} material={railMat}><boxGeometry args={[0.1, 1.2, 0.1]} /></mesh>
        <mesh position={[4.0, 0, -4.0]} material={railMat}><boxGeometry args={[0.1, 1.2, 0.1]} /></mesh>
        <mesh position={[0, 0, -4.0]} material={railMat}><boxGeometry args={[0.08, 1.2, 0.08]} /></mesh>
        <mesh position={[-4.0, 0, 0]} material={railMat}><boxGeometry args={[0.08, 1.2, 0.08]} /></mesh>
        <mesh position={[4.0, 0, 0]} material={railMat}><boxGeometry args={[0.08, 1.2, 0.08]} /></mesh>
        <mesh position={[-4.0, 0, 4.0]} material={railMat}><boxGeometry args={[0.1, 1.2, 0.1]} /></mesh>
        <mesh position={[4.0, 0, 4.0]} material={railMat}><boxGeometry args={[0.1, 1.2, 0.1]} /></mesh>
      </group>

      {/* ================= 5. 科幻軍事發光霓虹細節與戰術指示燈 ================= */}
      {/* 四角大型承重科幻霓虹柱 (高度 4.8 米) */}
      {[
        [-4.1, 4.1],
        [4.1, 4.1],
        [-4.1, -4.1],
        [4.1, -4.1]
      ].map(([x, z], i) => (
        <group key={i} position={[x, 2.4, z]}>
          {/* 主柱體 */}
          <mesh castShadow>
            <boxGeometry args={[0.3, 4.8, 0.3]} />
            <meshStandardMaterial color="#1a1f24" roughness={0.8} />
          </mesh>
          {/* 青色發光霓虹燈條 */}
          <mesh position={[x > 0 ? -0.16 : 0.16, 0, z > 0 ? -0.16 : 0.16]}>
            <boxGeometry args={[0.05, 4.8, 0.05]} />
            <meshBasicMaterial color="#00f0ff" />
          </mesh>
        </group>
      ))}

      {/* 大門上楣青色發光裝飾條 */}
      <mesh position={[0, 3.65, 4.02]}>
        <boxGeometry args={[3.0, 0.06, 0.06]} />
        <meshBasicMaterial color="#00f0ff" />
      </mesh>

      {/* 二樓護欄右上角戰術航標閃爍燈 */}
      <group position={[3.9, 4.9, 3.9]}>
        <mesh>
          <cylinderGeometry args={[0.05, 0.08, 0.2]} />
          <meshStandardMaterial color="#222" />
        </mesh>
        <mesh position={[0, 0.15, 0]}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshBasicMaterial color="#00f0ff" />
        </mesh>
        <pointLight position={[0, 0.2, 0]} color="#00f0ff" intensity={2.0} distance={6} />
      </group>
    </group>
  );
}

function AmmoSupplyStation({ position, active }) {
  return (
    <group position={position}>
      {/* 補給箱底座架 */}
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.2, 1.0]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>
      
      {/* 彈藥主箱體 (軍綠色金屬) */}
      <mesh position={[0, 0.6, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.8, 0.8]} />
        <meshStandardMaterial color="#2d4229" roughness={0.6} metalness={0.7} />
      </mesh>

      {/* 彈藥條紋與把手裝飾 */}
      <mesh position={[0, 0.6, 0.405]} castShadow>
        <boxGeometry args={[0.9, 0.15, 0.02]} />
        <meshStandardMaterial color="#141c12" roughness={0.8} />
      </mesh>
      
      {/* 發光條 (霓虹指示燈) */}
      <mesh position={[0, 1.01, 0]}>
        <boxGeometry args={[0.8, 0.04, 0.4]} />
        <meshBasicMaterial color={active ? "#00ff66" : "#ff3b3b"} />
      </mesh>
      
      {/* 光源 */}
      <pointLight 
        position={[0, 1.1, 0]} 
        color={active ? "#00ff66" : "#ff3b3b"} 
        intensity={active ? 2.5 : 0.6} 
        distance={5} 
      />
    </group>
  );
}

function MedicalSupplyStation({ position, active }) {
  return (
    <group position={position}>
      {/* 醫療箱支架 */}
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.2, 0.7]} />
        <meshStandardMaterial color="#222" roughness={0.9} />
      </mesh>

      {/* 醫療主箱體 (白色/淺灰色塑料) */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.6, 0.5]} />
        <meshStandardMaterial color="#eeeeee" roughness={0.5} metalness={0.1} />
      </mesh>

      {/* 紅十字標誌 */}
      <group position={[0, 0.5, 0.255]}>
        {/* 直條 */}
        <mesh castShadow>
          <boxGeometry args={[0.08, 0.26, 0.01]} />
          <meshStandardMaterial color="#ff2222" roughness={0.5} />
        </mesh>
        {/* 橫條 */}
        <mesh castShadow>
          <boxGeometry args={[0.26, 0.08, 0.01]} />
          <meshStandardMaterial color="#ff2222" roughness={0.5} />
        </mesh>
      </group>

      {/* 發光條 */}
      <mesh position={[0, 0.81, 0]}>
        <boxGeometry args={[0.5, 0.03, 0.3]} />
        <meshBasicMaterial color={active ? "#00e5ff" : "#ff3b3b"} />
      </mesh>

      {/* 光源 */}
      <pointLight 
        position={[0, 0.9, 0]} 
        color={active ? "#00e5ff" : "#ff3b3b"} 
        intensity={active ? 2.2 : 0.6} 
        distance={4} 
      />
    </group>
  );
}

function TacticalAssets() {
  return (
    <group>
      {/* 角落狙擊哨塔 - 外移至 ±95 以適應兩倍大地圖 */}
      <GuardTower position={[-95, 0, -95]} />
      <GuardTower position={[95, 0, 95]} />
      <GuardTower position={[-95, 0, 95]} />
      <GuardTower position={[95, 0, -95]} />

      {/* 1. 核心中心與中內圈掩體 (加入中心兩側的混凝土防撞牆) */}
      <MilitaryCrate position={[0, 0.6, 0]} scale={[1.2, 1.2, 1.2]} />
      <MilitaryCrate position={[1.4, 0.6, 0]} rotation={[0, 0.2, 0]} />
      <MilitaryCrate position={[-0.6, 0.6, 1.4]} rotation={[0, -0.4, 0]} />
      <MilitaryCrate position={[0.4, 1.8, 0.4]} rotation={[0, 0.7, 0]} scale={[0.9, 0.9, 0.9]} />
      <SandbagWall position={[0, 0, -3]} rotation={[0, 0, 0]} length={5} />
      <SandbagWall position={[0, 0, 3]} rotation={[0, 0, 0]} length={5} />
      <SandbagWall position={[-3, 0, 0]} rotation={[0, Math.PI / 2, 0]} length={4} />
      <SandbagWall position={[3, 0, 0]} rotation={[0, Math.PI / 2, 0]} length={4} />

      {/* 橫向中場混凝土防撞牆 (高達 2.4 米，提供高視線完全遮擋) */}
      <ConcreteBarrier position={[-12, 1.2, 0]} rotation={[0, Math.PI / 2, 0]} />
      <ConcreteBarrier position={[12, 1.2, 0]} rotation={[0, Math.PI / 2, 0]} />

      <SandbagWall position={[-28, 0, -28]} rotation={[0, Math.PI / 4, 0]} length={5} />
      <MilitaryCrate position={[-31, 0.6, -26]} rotation={[0, 0.5, 0]} />
      <SandbagWall position={[28, 0, 28]} rotation={[0, Math.PI / 4, 0]} length={5} />
      <MilitaryCrate position={[31, 0.6, 26]} rotation={[0, -0.2, 0]} />
      <SandbagWall position={[-28, 0, 28]} rotation={[0, -Math.PI / 4, 0]} length={5} />
      <MilitaryCrate position={[-31, 0.6, 26]} rotation={[0, 0.3, 0]} />
      <SandbagWall position={[28, 0, -28]} rotation={[0, -Math.PI / 4, 0]} length={5} />
      <MilitaryCrate position={[31, 0.6, -26]} rotation={[0, -0.5, 0]} />

      <SandbagWall position={[-15, 0, -15]} rotation={[0, 0.2, 0]} length={4} />
      <MilitaryCrate position={[-18, 0.6, -15]} />
      <SandbagWall position={[15, 0, -15]} rotation={[0, -0.2, 0]} length={4} />
      <MilitaryCrate position={[18, 0.6, -15]} />
      <SandbagWall position={[-15, 0, 15]} rotation={[0, 1.3, 0]} length={4} />
      <MilitaryCrate position={[-15, 0.6, 18]} />
      <SandbagWall position={[15, 0, 15]} rotation={[0, -1.3, 0]} length={4} />
      <MilitaryCrate position={[15, 0.6, 18]} />

      {/* 2. 玩家出生安全防護碉堡 (Z = 85 ~ 92，加入高集裝箱與混凝土牆) */}
      {/* 玩家正面防線：新增一組軍綠色軍用集裝箱 (高 2.6 米) 橫阻狙擊視線 */}
      <CargoContainer position={[0, 1.3, 85]} rotation={[0, Math.PI / 2, 0]} color="#424c3e" />
      <SandbagWall position={[0, 0, 88]} length={6} />
      <MilitaryCrate position={[-1.5, 0.6, 89.5]} />
      <MilitaryCrate position={[1.5, 0.6, 89.5]} />
      
      {/* 兩側新增混凝土防撞牆 (高 2.4 米)，提供極佳生存空間 */}
      <ConcreteBarrier position={[-3.5, 1.2, 89.5]} rotation={[0, 0.2, 0]} />
      <ConcreteBarrier position={[3.5, 1.2, 89.5]} rotation={[0, -0.2, 0]} />
      
      <SandbagWall position={[-4.5, 0, 90]} rotation={[0, 0.5, 0]} length={4} />
      <MilitaryCrate position={[-5.5, 0.6, 91.5]} rotation={[0, 0.2, 0]} />
      <SandbagWall position={[4.5, 0, 90]} rotation={[0, -0.5, 0]} length={4} />
      <MilitaryCrate position={[5.5, 0.6, 91.5]} rotation={[0, -0.2, 0]} />

      {/* 3. 南側中後場防禦線與建築物 (Z = 50 ~ 80) */}
      {/* 左右新增大型集裝箱 (高 2.6 米) */}
      <CargoContainer position={[-30, 1.3, 60]} color="#7c5c43" />
      <CargoContainer position={[30, 1.3, 60]} color="#384952" />
      <MilitaryCrate position={[-33, 0.6, 59]} rotation={[0, 0.1, 0]} />
      <MilitaryCrate position={[33, 0.6, 59]} rotation={[0, -0.1, 0]} />
      
      {/* 左右新增 L型斷垣殘壁 (高 3.2 米) */}
      <TacticalRuin position={[-15, 0, 70]} rotation={[0, 0.4, 0]} />
      <TacticalRuin position={[15, 0, 70]} rotation={[0, -0.8, 0]} />
      <MilitaryCrate position={[-15, 0.6, 72]} />
      <MilitaryCrate position={[15, 0.6, 72]} />
      
      <SandbagWall position={[0, 0, 55]} rotation={[0, 0, 0]} length={5} />
      <MilitaryCrate position={[0, 0.6, 56.5]} />

      {/* 4. 北側中前場防禦線與建築物 (Z = -50 ~ -80) */}
      {/* 左右對稱新增集裝箱與廢墟牆面 */}
      <CargoContainer position={[-30, 1.3, -60]} color="#384952" />
      <CargoContainer position={[30, 1.3, -60]} color="#7c5c43" />
      <MilitaryCrate position={[-33, 0.6, -61]} rotation={[0, 0.2, 0]} />
      <MilitaryCrate position={[33, 0.6, -61]} rotation={[0, -0.2, 0]} />
      
      <TacticalRuin position={[-15, 0, -70]} rotation={[0, 2.2, 0]} />
      <TacticalRuin position={[15, 0, -70]} rotation={[0, -1.5, 0]} />
      <MilitaryCrate position={[-15, 0.6, -72]} />
      <MilitaryCrate position={[15, 0.6, -72]} />
      
      <SandbagWall position={[0, 0, -55]} rotation={[0, 0, 0]} length={5} />
      <MilitaryCrate position={[0, 0.6, -56.5]} />

      {/* 5. 東西兩翼外圍貨櫃區 (X = ±60, ±80) */}
      <CargoContainer position={[-60, 1.3, -30]} rotation={[0, Math.PI / 2, 0]} color="#4b5945" />
      <CargoContainer position={[60, 1.3, -30]} rotation={[0, Math.PI / 2, 0]} color="#4b5945" />
      <CargoContainer position={[-60, 1.3, 30]} rotation={[0, Math.PI / 2, 0]} color="#4b5945" />
      <CargoContainer position={[60, 1.3, 30]} rotation={[0, Math.PI / 2, 0]} color="#4b5945" />
      
      <SandbagWall position={[-80, 0, 0]} rotation={[0, 0.5, 0]} length={6} />
      <MilitaryCrate position={[-80, 0.6, 1.5]} />
      <SandbagWall position={[80, 0, 0]} rotation={[0, -0.5, 0]} length={6} />
      <MilitaryCrate position={[80, 0.6, 1.5]} />

      {/* 6. 全新大型空心軍事碉堡 (可進入，內部設有掩體箱) */}
      <MilitaryBunker position={[-45, 0, -20]} />
      <MilitaryBunker position={[45, 0, 20]} />
      <MilitaryBunker position={[-15, 0, -45]} />

      {/* 7. 全新雙層大型軍事建築 (包含二樓平台、斜坡及科幻霓虹發光立柱) */}
      <TwoStoryBuilding position={[-65, 0, -45]} />
      <TwoStoryBuilding position={[65, 0, 45]} />
    </group>
  );
}

// ==========================================
// 4. 第一人稱突擊步槍組件 (採用中空反射式紅點瞄準鏡，完全防遮擋)
// ==========================================
function Weapon({ gunRef, muzzleFlashRef, isAds, isLocked, activeWeapon, isHealing }) {
  const medkitRef = useRef();
  const medkitLerp = useRef(0);

  useFrame((state, delta) => {
    const safeDelta = Math.min(delta, 0.1);
    medkitLerp.current = THREE.MathUtils.lerp(medkitLerp.current, isHealing ? 1.0 : 0.0, 10.0 * safeDelta);
    
    if (medkitRef.current) {
      const time = state.clock.getElapsedTime();
      const bobY = Math.sin(time * 5.0) * 0.02 * medkitLerp.current;
      const bobRotZ = Math.cos(time * 3.0) * 0.03 * medkitLerp.current;
      
      // 當 medkitLerp 為 1.0 時，醫療包將移至中心可見位置
      medkitRef.current.position.x = 0.05;
      medkitRef.current.position.y = THREE.MathUtils.lerp(-1.2, -0.28, medkitLerp.current) + bobY;
      medkitRef.current.position.z = THREE.MathUtils.lerp(-0.2, -0.65, medkitLerp.current);
      medkitRef.current.rotation.x = THREE.MathUtils.lerp(0.8, 0.25, medkitLerp.current);
      medkitRef.current.rotation.y = THREE.MathUtils.lerp(-0.5, 0.1, medkitLerp.current);
      medkitRef.current.rotation.z = bobRotZ;
      medkitRef.current.visible = medkitLerp.current > 0.01;
    }
  });

  return (
    <group ref={gunRef} name="weapon">
      {/* 槍支本體群組，補血時往下滑出螢幕 */}
      <group 
        rotation={[0, Math.PI, 0]} 
        scale={[0.13, 0.13, 0.13]} 
        position={[0, -1.5 * medkitLerp.current, 0]}
      >
        
        {/* 槍口閃光 (Muzzle Flash) - 共用以維持 ref 綁定與光源定位 */}
        <mesh 
          ref={muzzleFlashRef} 
          position={activeWeapon === 'primary' ? [0, -0.04, 2.9] : [0, 0.28, 1.0]} 
          visible={false}
        >
          <sphereGeometry args={[activeWeapon === 'primary' ? 0.25 : 0.15, 8, 8]} />
          <meshBasicMaterial color="#ffaa00" transparent opacity={0.9} />
          <pointLight color="#ffaa00" intensity={4} distance={6} />
        </mesh>

        {activeWeapon === 'primary' ? (
          <>
            {/* 1. 機匣/槍身本體 (Receiver) */}
            <mesh castShadow>
              <boxGeometry args={[0.26, 0.45, 1.9]} />
              <meshStandardMaterial color="#1e1e1e" roughness={0.8} />
            </mesh>
            
            {/* 2. 槍托 (Stock) */}
            <mesh position={[0, 0.08, -1.3]} castShadow>
              <boxGeometry args={[0.2, 0.38, 0.9]} />
              <meshStandardMaterial color="#161616" roughness={0.9} />
            </mesh>
            
            {/* 3. 戰術護木 (Handguard) */}
            <mesh position={[0, -0.04, 1.4]} castShadow>
              <boxGeometry args={[0.24, 0.32, 1.1]} />
              <meshStandardMaterial color="#94846c" roughness={0.85} />
            </mesh>
            
            {/* 4. 槍管 (Barrel) */}
            <mesh position={[0, -0.04, 2.3]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.035, 0.035, 0.8]} />
              <meshStandardMaterial color="#111" roughness={0.5} />
            </mesh>
            
            {/* 5. 槍口消焰器 (Flash Hider) */}
            <mesh position={[0, -0.04, 2.75]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.05, 0.05, 0.16]} />
              <meshStandardMaterial color="#080808" />
            </mesh>
            
            {/* 7. 戰術彈匣 (Magazine) */}
            <mesh position={[0, -0.48, 0.5]} rotation={[0.22, 0, 0]} castShadow>
              <boxGeometry args={[0.14, 0.72, 0.32]} />
              <meshStandardMaterial color="#252525" roughness={0.8} />
            </mesh>
            
            {/* 8. 手槍握把 (Pistol Grip) */}
            <mesh position={[0, -0.38, -0.45]} rotation={[-0.42, 0, 0]} castShadow>
              <boxGeometry args={[0.16, 0.48, 0.24]} />
              <meshStandardMaterial color="#161616" roughness={0.8} />
            </mesh>
            
            {/* 9. 瞄準鏡架支架 */}
            <mesh position={[0, 0.42, 0.15]} castShadow>
              <boxGeometry args={[0.2, 0.18, 0.5]} />
              <meshStandardMaterial color="#1f1f1f" />
            </mesh>
            
            {/* 10. 中空瞄準鏡筒 (Hollow Cylinder, openEnded: true, DoubleSide 材質，可完全看穿) */}
            <mesh position={[0, 0.58, 0.15]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.32, 0.32, 0.18, 32, 1, true]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.4} metalness={0.8} side={THREE.DoubleSide} />
            </mesh>

            {/* 11. 3D 紅點瞄準線 (懸浮於鏡筒中心，開鏡時顯示) */}
            {isAds && (
              <group position={[0, 0.58, 0.15]}>
                {/* 中心紅色實心瞄準點 (不進行深度檢測，永遠懸浮於畫面上方) */}
                <mesh>
                  <circleGeometry args={[0.007, 16]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.9} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                {/* 紅色外圈瞄準環 */}
                <mesh position={[0, 0, 0.001]}>
                  <ringGeometry args={[0.024, 0.028, 24]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.75} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
              </group>
            )}
          </>
        ) : (
          <>
            {/* M9 Pistol Model */}
            {/* 1. 滑套 (Slide) - 頂部金屬 */}
            <mesh position={[0, 0.18, 0.3]} castShadow>
              <boxGeometry args={[0.18, 0.22, 1.0]} />
              <meshStandardMaterial color="#2d2d2d" roughness={0.5} metalness={0.7} />
            </mesh>

            {/* 2. 槍身底座 (Frame) */}
            <mesh position={[0, 0.04, 0.35]} castShadow>
              <boxGeometry args={[0.16, 0.16, 0.7]} />
              <meshStandardMaterial color="#1e1e1e" roughness={0.8} />
            </mesh>

            {/* 3. 槍管 (Barrel) */}
            <mesh position={[0, 0.2, 0.85]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.03, 0.03, 0.2]} />
              <meshStandardMaterial color="#111111" roughness={0.3} metalness={0.8} />
            </mesh>

            {/* 4. 手槍握把 (Grip) */}
            <mesh position={[0, -0.22, 0.1]} rotation={[-0.2, 0, 0]} castShadow>
              <boxGeometry args={[0.15, 0.45, 0.22]} />
              <meshStandardMaterial color="#121212" roughness={0.95} />
            </mesh>

            {/* 5. 扳機護圈 (Trigger Guard) */}
            <mesh position={[0, -0.08, 0.42]} castShadow>
              <boxGeometry args={[0.08, 0.12, 0.15]} />
              <meshStandardMaterial color="#1e1e1e" />
            </mesh>

            {/* 6. 紅點瞄準鏡底座 */}
            <mesh position={[0, 0.33, 0.1]} castShadow>
              <boxGeometry args={[0.14, 0.08, 0.24]} />
              <meshStandardMaterial color="#1e1e1e" roughness={0.7} />
            </mesh>

            {/* 7. 紅點瞄準鏡框 */}
            <mesh position={[0, 0.45, 0.1]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.16, 0.16, 0.12, 16, 1, true]} />
              <meshStandardMaterial color="#181818" roughness={0.4} metalness={0.7} side={THREE.DoubleSide} />
            </mesh>

            {/* 8. 3D 紅點瞄準線 (開鏡時顯示) */}
            {isAds && (
              <group position={[0, 0.58, 0.1]}>
                {/* 中心紅色實心瞄準點 (不進行深度檢測，永遠懸浮於畫面上方) */}
                <mesh>
                  <circleGeometry args={[0.007, 16]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.9} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                {/* 紅色外圈瞄準環 */}
                <mesh position={[0, 0, 0.001]}>
                  <ringGeometry args={[0.024, 0.028, 24]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.75} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
              </group>
            )}
          </>
        )}
      </group>

      {/* 獨立的 3D 醫療包模型，只有在 isHealing 時顯示，並由 useFrame 動態動畫控制 */}
      <group ref={medkitRef} scale={[0.15, 0.15, 0.15]} visible={false}>
        {/* 醫療包本體 (白色外殼) */}
        <mesh castShadow>
          <boxGeometry args={[1.5, 1.0, 0.5]} />
          <meshStandardMaterial color="#eeeeee" roughness={0.5} metalness={0.2} />
        </mesh>
        
        {/* 醫療包中央的綠色十字圖案 (橫) */}
        <mesh position={[0, 0, 0.26]}>
          <boxGeometry args={[0.7, 0.2, 0.05]} />
          <meshBasicMaterial color="#00ff66" />
        </mesh>
        {/* 醫療包中央的綠色十字圖案 (直) */}
        <mesh position={[0, 0, 0.26]}>
          <boxGeometry args={[0.2, 0.7, 0.05]} />
          <meshBasicMaterial color="#00ff66" />
        </mesh>

        {/* 醫療包側邊鎖扣 (金屬質感) */}
        <mesh position={[-0.6, 0.51, 0]} castShadow>
          <boxGeometry args={[0.2, 0.05, 0.2]} />
          <meshStandardMaterial color="#888888" roughness={0.3} metalness={0.9} />
        </mesh>
        <mesh position={[0.6, 0.51, 0]} castShadow>
          <boxGeometry args={[0.2, 0.05, 0.2]} />
          <meshStandardMaterial color="#888888" roughness={0.3} metalness={0.9} />
        </mesh>

        {/* 頂部把手 */}
        <mesh position={[0, 0.6, 0]} castShadow>
          <boxGeometry args={[0.5, 0.15, 0.1]} />
          <meshStandardMaterial color="#222222" roughness={0.8} />
        </mesh>

        {/* 醫療包散發的綠色治癒光芒 */}
        <pointLight color="#00ff66" intensity={2.5} distance={3} />
      </group>
    </group>
  );
}

// ==========================================
// 5. 彈孔與沙沙噴射粒子
// ==========================================
function BulletHole({ position, normal }) {
  const meshRef = useRef();

  const offsetPosition = [
    position.x + normal.x * 0.003,
    position.y + normal.y * 0.003,
    position.z + normal.z * 0.003,
  ];

  useEffect(() => {
    if (meshRef.current) {
      const target = new THREE.Vector3().copy(meshRef.current.position).add(normal);
      meshRef.current.lookAt(target);
    }
  }, [normal]);

  return (
    <mesh ref={meshRef} position={offsetPosition}>
      <planeGeometry args={[0.07, 0.07]} />
      <meshBasicMaterial color="#151515" transparent opacity={0.8} depthWrite={false} />
    </mesh>
  );
}

function DustParticle({ position, velocity, color }) {
  const meshRef = useRef();

  useFrame((state, delta) => {
    if (meshRef.current) {
      meshRef.current.position.addScaledVector(velocity, delta);
      velocity.y -= 9.8 * delta;
      meshRef.current.scale.multiplyScalar(Math.max(0, 1 - delta * 1.6));
    }
  });

  return (
    <mesh ref={meshRef} position={[position.x, position.y, position.z]}>
      <boxGeometry args={[0.04, 0.04, 0.04]} />
      <meshBasicMaterial color={color} transparent opacity={0.65} />
    </mesh>
  );
}

// 實體拋殼元件
function ShellCasing({ position, velocity }) {
  const meshRef = useRef();
  const vel = useRef(velocity.clone());

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const pos = meshRef.current.position;

    // 重力
    vel.current.y -= 9.8 * delta;

    // 位移
    pos.addScaledVector(vel.current, delta);

    // 隨機旋轉
    meshRef.current.rotation.x += delta * 12;
    meshRef.current.rotation.y += delta * 6;

    // 地面反彈與摩擦力
    if (pos.y <= 0.02) {
      pos.y = 0.02;
      if (vel.current.y < -0.8) {
        vel.current.y = -vel.current.y * 0.35; // 彈跳力
        vel.current.x *= 0.5;
        vel.current.z *= 0.5;
      } else {
        // 完全靜止
        vel.current.set(0, 0, 0);
        meshRef.current.rotation.set(0, 0.2, 0);
      }
    }
  });

  return (
    <mesh ref={meshRef} position={[position.x, position.y, position.z]} castShadow>
      <cylinderGeometry args={[0.006, 0.006, 0.03, 6]} />
      <meshStandardMaterial color="#c5a059" metalness={0.9} roughness={0.2} />
    </mesh>
  );
}

// 實體彈匣掉落元件
function DroppedMagazine({ position, velocity }) {
  const meshRef = useRef();
  const vel = useRef(velocity.clone());

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const pos = meshRef.current.position;

    vel.current.y -= 9.8 * delta;
    pos.addScaledVector(vel.current, delta);
    meshRef.current.rotation.x += delta * 5;

    // 地面反彈判定
    if (pos.y <= 0.05) {
      pos.y = 0.05;
      if (vel.current.y < -0.8) {
        vel.current.y = -vel.current.y * 0.22;
        vel.current.x *= 0.4;
        vel.current.z *= 0.4;
      } else {
        vel.current.set(0, 0, 0);
        meshRef.current.rotation.set(Math.PI / 2, 0.1, 0); // 躺在地上
      }
    }
  });

  return (
    <mesh ref={meshRef} position={[position.x, position.y, position.z]} castShadow>
      <boxGeometry args={[0.02, 0.09, 0.04]} />
      <meshStandardMaterial color="#1e1e1e" roughness={0.8} />
    </mesh>
  );
}

// 實體戰術手榴彈元件
function Grenade({ position, velocity, onExplode }) {
  const meshRef = useRef();
  const vel = useRef(velocity.clone());
  const timer = useRef(2.5); // 2.5 秒定時引信
  const [ledColor, setLedColor] = useState('#ff0000');

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const pos = meshRef.current.position;

    timer.current -= delta;
    if (timer.current <= 0) {
      onExplode(pos.clone());
      return;
    }

    // 紅色 LED 警示快閃
    const flashIndex = Math.floor(state.clock.getElapsedTime() * 12) % 2;
    setLedColor(flashIndex === 0 ? '#ff0000' : '#1a0000');

    // 重力
    vel.current.y -= 9.8 * delta;

    // 位移
    pos.addScaledVector(vel.current, delta);

    // 飛出旋轉
    meshRef.current.rotation.x += delta * 6;
    meshRef.current.rotation.y += delta * 3;

    // 地面碰撞彈跳
    if (pos.y <= 0.1) {
      pos.y = 0.1;
      if (Math.abs(vel.current.y) > 0.6) {
        vel.current.y = -vel.current.y * 0.45;
        vel.current.x *= 0.75;
        vel.current.z *= 0.75;
      } else {
        vel.current.y = 0;
        vel.current.x *= 0.9 * (1 - delta);
        vel.current.z *= 0.9 * (1 - delta);
      }
    }

    // 地圖牆面碰撞彈跳 (配合外牆位置 Z/X = ±120，將彈跳限制設定為 119)
    const limit = 119;
    if (Math.abs(pos.x) >= limit) {
      pos.x = Math.sign(pos.x) * limit;
      vel.current.x = -vel.current.x * 0.55;
    }
    if (Math.abs(pos.z) >= limit) {
      pos.z = Math.sign(pos.z) * limit;
      vel.current.z = -vel.current.z * 0.55;
    }
  });

  return (
    <group position={[position.x, position.y, position.z]} ref={meshRef}>
      {/* 手榴彈墨綠球體 */}
      <mesh castShadow>
        <sphereGeometry args={[0.13, 10, 10]} />
        <meshStandardMaterial color="#2d3b25" roughness={0.9} />
      </mesh>
      {/* 金屬保險栓 */}
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.05, 6]} />
        <meshStandardMaterial color="#4f4f4f" metalness={0.7} />
      </mesh>
      {/* 紅色 LED 警示燈 */}
      <mesh position={[0.08, 0.08, 0]}>
        <sphereGeometry args={[0.016, 6, 6]} />
        <meshBasicMaterial color={ledColor} />
      </mesh>
      {ledColor === '#ff0000' && (
        <pointLight color="#ff0000" intensity={2} distance={4} />
      )}
    </group>
  );
}

// ==========================================
// 6. 玩家控制與射擊 Raycaster 控制器
// ==========================================
function PlayerController({
  weaponRef,
  muzzleFlashRef,
  ammo,
  setAmmo,
  isReloading,
  isHealing,
  gameState,
  onHitEnemy,
  addImpactEffect,
  resetTrigger,
  isAds,
  setIsAds,
  fireMode,
  grenades,
  setGrenades,
  addCasing,
  addDroppedMag,
  addGrenade,
  shakeTrigger,
  enemies,
  setNearStation,
  onInteractAmmo,
  onInteractMed,
  isTutorial,
  onTriggerTutorial,
  activeWeapon,
  device,
  mobileKeysRef,
  mobileFiring,
  mobileGrenadeTrigger,
  runStatsRef,
}) {
  const { camera, scene } = useThree();
  const keys = useKeyboard();
  
  // 物理與移動狀態
  const velocityY = useRef(0);
  const isGrounded = useRef(true);
  const mapLimit = 118;
  
  // 武器物理反饋緩衝與開鏡平滑係數
  const prevRotation = useRef(new THREE.Euler());
  const weaponOffset = useRef(new THREE.Vector3());
  const weaponTargetOffset = useRef(new THREE.Vector3());
  const recoilOffset = useRef(0);
  
  // 開鏡平滑動畫計數器 (0=腰射, 1=完全開鏡)
  const adsLerp = useRef(0);

  // 鏡頭受爆炸波及震動幅度
  const shakeAmount = useRef(0);

  // 補給站鄰近狀態暫存 Ref
  const prevNearStation = useRef(null);

  // 連發射擊與按鍵狀態的 refs 緩衝 (避免 R3F 渲染循環中的閉包捕獲過期狀態)
  const isMouseDown = useRef(false);
  const lastFireTime = useRef(0);
  const ammoRef = useRef(ammo);
  const isReloadingRef = useRef(isReloading);
  const isHealingRef = useRef(isHealing);
  const fireModeRef = useRef(fireMode);
  const gameStateRef = useRef(gameState);
  const activeWeaponRef = useRef(activeWeapon);

  const isTutorialRef = useRef(isTutorial);
  const onTriggerTutorialRef = useRef(onTriggerTutorial);

  const setAmmoRef = useRef(setAmmo);
  const enemiesRef = useRef(enemies);
  const onHitEnemyRef = useRef(onHitEnemy);
  const addImpactEffectRef = useRef(addImpactEffect);
  const addCasingRef = useRef(addCasing);

  // 行動端滑動看視角 Refs
  const lookTouchId = useRef(null);
  const lastLookPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    isTutorialRef.current = isTutorial;
  }, [isTutorial]);

  useEffect(() => {
    onTriggerTutorialRef.current = onTriggerTutorial;
  }, [onTriggerTutorial]);

  useEffect(() => {
    ammoRef.current = ammo;
  }, [ammo]);

  useEffect(() => {
    isReloadingRef.current = isReloading;
  }, [isReloading]);

  useEffect(() => {
    isHealingRef.current = isHealing;
  }, [isHealing]);

  useEffect(() => {
    fireModeRef.current = fireMode;
  }, [fireMode]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    activeWeaponRef.current = activeWeapon;
  }, [activeWeapon]);

  useEffect(() => {
    setAmmoRef.current = setAmmo;
  }, [setAmmo]);

  useEffect(() => {
    enemiesRef.current = enemies;
  }, [enemies]);

  useEffect(() => {
    onHitEnemyRef.current = onHitEnemy;
  }, [onHitEnemy]);

  useEffect(() => {
    addImpactEffectRef.current = addImpactEffect;
  }, [addImpactEffect]);

  useEffect(() => {
    addCasingRef.current = addCasing;
  }, [addCasing]);

  // 同步行動端開火狀態到 isMouseDown
  useEffect(() => {
    isMouseDown.current = mobileFiring;
    if (mobileFiring && fireModeRef.current === 'semi') {
      const now = performance.now() / 1000;
      const fireInterval = activeWeaponRef.current === 'primary' ? 0.11 : 0.2;
      if (now - lastFireTime.current >= fireInterval) {
        lastFireTime.current = now;
        fireOneBullet();
      }
    }
  }, [mobileFiring]);

  // 行動端滑動旋轉視角觸控監聽
  useEffect(() => {
    if (device !== 'mobile' || gameState !== 'active') return;

    const handleTouchStart = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        
        // 避開左側搖桿區與右側的所有按鈕、互動框
        const isJoystickArea = touch.clientX < window.innerWidth * 0.45 && touch.clientY > window.innerHeight * 0.45;
        const isButton = e.target.closest('button') || e.target.closest('.mobile-btn') || e.target.closest('.mobile-pause-btn') || e.target.closest('.interaction-prompt');
        
        if (!isJoystickArea && !isButton && lookTouchId.current === null) {
          lookTouchId.current = touch.identifier;
          lastLookPos.current = { x: touch.clientX, y: touch.clientY };
          break;
        }
      }
    };

    const handleTouchMove = (e) => {
      if (lookTouchId.current === null) return;
      
      let lookTouch = null;
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === lookTouchId.current) {
          lookTouch = e.touches[i];
          break;
        }
      }
      
      if (!lookTouch) return;

      const deltaX = lookTouch.clientX - lastLookPos.current.x;
      const deltaY = lookTouch.clientY - lastLookPos.current.y;
      
      lastLookPos.current = { x: lookTouch.clientX, y: lookTouch.clientY };

      const sensitivity = 0.0035;
      camera.rotation.y -= deltaX * sensitivity;
      camera.rotation.x -= deltaY * sensitivity;
      camera.rotation.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, camera.rotation.x));
    };

    const handleTouchEnd = (e) => {
      if (lookTouchId.current === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lookTouchId.current) {
          lookTouchId.current = null;
          break;
        }
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [device, gameState, camera]);

  // 監聽爆炸產生的鏡頭抖動
  useEffect(() => {
    if (shakeTrigger > 0) {
      shakeAmount.current = 0.22;
    }
  }, [shakeTrigger]);

  // 監聽重新裝彈時實體彈匣從槍身落地
  useEffect(() => {
    if (isReloading && weaponRef.current) {
      try {
        const localMagPos = activeWeaponRef.current === 'primary' 
          ? new THREE.Vector3(0, -0.06, 0.05) 
          : new THREE.Vector3(0, -0.22, 0.1);
        const magPos = localMagPos.applyMatrix4(weaponRef.current.matrixWorld);
        const magVel = new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          -1.2,
          -0.2 - Math.random() * 0.3
        ).applyQuaternion(camera.quaternion);
        addDroppedMag(magPos, magVel);
      } catch (e) {
        console.warn('Magazine drop error:', e);
      }
    }
  }, [isReloading, weaponRef, addDroppedMag, camera]);

  // 監聽 G 鍵拋擲手榴彈
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyG' && gameStateRef.current === 'active' && (device === 'mobile' || document.pointerLockElement)) {
        if (grenades > 0) {
          setGrenades((prev) => prev - 1);
          
          const pos = camera.position.clone();
          const dir = new THREE.Vector3();
          camera.getWorldDirection(dir);
          
          // 起點置於相機前方少許，並依仰角方向飛出
          const startPos = pos.clone().add(dir.clone().multiplyScalar(0.4));
          const velocity = dir.clone().multiplyScalar(13.0);
          velocity.y += 4.5; // 拋射角向上速度
          
          addGrenade(startPos, velocity);

          if (isTutorialRef.current) {
            onTriggerTutorialRef.current('grenade');
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [grenades, camera, addGrenade, setGrenades, device]);

  // 監聽行動端按鈕拋擲手榴彈
  useEffect(() => {
    if (mobileGrenadeTrigger > 0 && gameStateRef.current === 'active') {
      if (grenades > 0) {
        setGrenades((prev) => prev - 1);
        
        const pos = camera.position.clone();
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        
        const startPos = pos.clone().add(dir.clone().multiplyScalar(0.4));
        const velocity = dir.clone().multiplyScalar(13.0);
        velocity.y += 4.5;
        
        addGrenade(startPos, velocity);

        if (isTutorialRef.current) {
          onTriggerTutorialRef.current('grenade');
        }
      }
    }
  }, [mobileGrenadeTrigger]);

  // 監聽 E 鍵進行補給站互動
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyE' && gameStateRef.current === 'active' && (device === 'mobile' || document.pointerLockElement)) {
        if (prevNearStation.current === 'ammo') {
          onInteractAmmo();
        } else if (prevNearStation.current === 'med') {
          onInteractMed();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onInteractAmmo, onInteractMed, device]);

  // 監聽重置訊號
  useEffect(() => {
    if (resetTrigger > 0) {
      camera.position.set(0, 1.6, 95); // 玩家初始與重置出生點向後移至安全碉堡內 [0, 1.6, 95]
      camera.rotation.set(0, 0, 0);
      prevRotation.current.set(0, 0, 0);
      weaponOffset.current.set(0, 0, 0);
      weaponTargetOffset.current.set(0, 0, 0);
      recoilOffset.current = 0;
      adsLerp.current = 0;
      isMouseDown.current = false;
      shakeAmount.current = 0;
    }
  }, [resetTrigger, camera]);

  // 監聽滑鼠右鍵點擊進入與放開開鏡瞄準 (ADS)
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (e.button === 2) {
        if (gameStateRef.current === 'active' && (device === 'mobile' || document.pointerLockElement) && !isHealingRef.current) {
          setIsAds(true);
        }
      }
    };

    const handleMouseUp = (e) => {
      if (e.button === 2) {
        setIsAds(false);
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setIsAds, device]);

  // 核心單發開火函式
  const fireOneBullet = () => {
    if (gameStateRef.current !== 'active' || isReloadingRef.current || isHealingRef.current || ammoRef.current <= 0) return;

    if (runStatsRef && runStatsRef.current) {
      runStatsRef.current.shotsFired += 1;
    }

    // 播放合成槍聲
    if (activeWeaponRef.current === 'primary') {
      soundManager.playGunshot();
    } else {
      soundManager.playPistolGunshot();
    }

    setAmmoRef.current((prev) => {
      const next = prev - 1;
      ammoRef.current = next; // 立即同步更新 ref，確保同一個 frame 內連續判定時讀取正確
      return next;
    });

    // 實體拋殼物理拋射 (從槍身右側拋殼窗飛出)
    if (weaponRef.current) {
      try {
        const localEjectPos = activeWeaponRef.current === 'primary' 
          ? new THREE.Vector3(0.04, -0.02, -0.05) 
          : new THREE.Vector3(0.04, 0.18, 0.3);
        const ejectPos = localEjectPos.applyMatrix4(weaponRef.current.matrixWorld);
        const ejectVel = new THREE.Vector3(
          2.2 + Math.random() * 0.8,
          1.8 + Math.random() * 0.6,
          -0.2 - Math.random() * 0.4
        ).applyQuaternion(camera.quaternion);
        addCasingRef.current(ejectPos, ejectVel);
      } catch (e) {
        console.warn('Shell eject error:', e);
      }
    }

    if (muzzleFlashRef.current) {
      muzzleFlashRef.current.visible = true;
      setTimeout(() => {
        if (muzzleFlashRef.current) muzzleFlashRef.current.visible = false;
      }, 50);
    }

    recoilOffset.current = activeWeaponRef.current === 'primary' ? 0.07 : 0.04;

    let currentSpread = 0.02;
    const keyboardState = keys.current;
    const keysState = {
      moveForward: keyboardState.moveForward || (mobileKeysRef.current ? mobileKeysRef.current.moveForward : false),
      moveBackward: keyboardState.moveBackward || (mobileKeysRef.current ? mobileKeysRef.current.moveBackward : false),
      moveLeft: keyboardState.moveLeft || (mobileKeysRef.current ? mobileKeysRef.current.moveLeft : false),
      moveRight: keyboardState.moveRight || (mobileKeysRef.current ? mobileKeysRef.current.moveRight : false),
      jump: keyboardState.jump || (mobileKeysRef.current ? mobileKeysRef.current.jump : false),
      run: keyboardState.run || (mobileKeysRef.current ? mobileKeysRef.current.run : false),
      crouch: keyboardState.crouch || (mobileKeysRef.current ? mobileKeysRef.current.crouch : false),
    };
    const isMoving = keysState.moveForward || keysState.moveBackward || keysState.moveLeft || keysState.moveRight;

    if (!isGrounded.current) {
      currentSpread = 0.09;
    } else if (keysState.run && isMoving && !isAds) {
      currentSpread = 0.06;
    } else if (isMoving) {
      currentSpread = 0.035;
    }

    const finalSpread = THREE.MathUtils.lerp(currentSpread, 0.001, adsLerp.current);

    const spreadX = (Math.random() - 0.5) * finalSpread;
    const spreadY = (Math.random() - 0.5) * finalSpread;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(spreadX, spreadY), camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
      let hit = null;
      for (let i = 0; i < intersects.length; i++) {
        let obj = intersects[i].object;
        
        // Skip player self, weapon meshes, cosmetics, and helper lines/grids
        let skip = false;
        let parent = obj;
        while (parent) {
          if (parent.name === 'weapon' || 
              parent.name === 'player' || 
              parent.name === 'bullet_hole' || 
              parent.name === 'tracer' || 
              parent.name === 'casing' || 
              parent.name === 'magazine' ||
              parent.type === 'GridHelper' ||
              parent.type === 'LineSegments' ||
              parent.type === 'Line' ||
              parent.userData.isPlayer) {
            skip = true;
            break;
          }
          parent = parent.parent;
        }
        if (skip) continue;
        
        hit = intersects[i];
        break;
      }

      if (hit) {
        let enemyId = null;
        let parent = hit.object;
        while (parent) {
          if (parent.userData && parent.userData.isEnemy) {
            enemyId = parent.userData.enemyId;
            break;
          }
          parent = parent.parent;
        }

        if (enemyId !== null) {
          const enemyObj = enemiesRef.current.find((e) => e.id === enemyId);
          let isHeadshot = false;
          if (enemyObj) {
            isHeadshot = hit.point.y >= enemyObj.position.y + 1.55;
          }
          if (runStatsRef && runStatsRef.current) {
            runStatsRef.current.shotsHit += 1;
            if (isHeadshot) {
              runStatsRef.current.headshots += 1;
            }
          }
          onHitEnemyRef.current(enemyId, hit.point, isHeadshot);
        } else {
          addImpactEffectRef.current(hit.point, hit.face.normal);
        }
      }
    }
  };

  // 統一處理滑鼠左鍵點擊與按住 (單發 / 連發判定)
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (e.button !== 0) return;
      if (gameStateRef.current !== 'active' || isReloadingRef.current || isHealingRef.current || ammoRef.current <= 0) return;
      if (!document.pointerLockElement) return;

      isMouseDown.current = true;

      const now = performance.now() / 1000;
      const fireInterval = activeWeaponRef.current === 'primary' ? 0.11 : 0.2;
      if (fireModeRef.current === 'semi') {
        if (now - lastFireTime.current >= fireInterval) {
          lastFireTime.current = now;
          fireOneBullet();
        }
      } else if (fireModeRef.current === 'auto') {
        // 全自動連發：點下時如果冷卻已過，立刻發射第一槍
        if (now - lastFireTime.current >= fireInterval) {
          lastFireTime.current = now;
          fireOneBullet();
        }
      }
    };

    const handleMouseUp = (e) => {
      if (e.button === 0) {
        isMouseDown.current = false;
      }
    };

    const handlePointerLockChange = () => {
      if (!document.pointerLockElement) {
        isMouseDown.current = false;
      }
    };

    const handleBlur = () => {
      isMouseDown.current = false;
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // 每影格邏輯更新
  useFrame((state, delta) => {
    const safeDelta = Math.min(delta, 0.1);

    // ------------------------------------------
    // 6.X 補給站鄰近狀態與距離檢測
    // ------------------------------------------
    const playerPos2D = new THREE.Vector3(camera.position.x, 0, camera.position.z);
    const distToAmmo = playerPos2D.distanceTo(AMMO_STATION_POS);
    const distToMed = playerPos2D.distanceTo(MED_STATION_POS);

    let currentNear = null;
    if (distToAmmo < 2.8) {
      currentNear = 'ammo';
    } else if (distToMed < 2.8) {
      currentNear = 'med';
    }

    if (currentNear !== prevNearStation.current) {
      prevNearStation.current = currentNear;
      setNearStation(currentNear);
    }

    // ------------------------------------------
    // 連發射擊邏輯 (全自動模式下按住滑鼠)
    // ------------------------------------------
    if (fireModeRef.current === 'auto' && isMouseDown.current) {
      const now = performance.now() / 1000;
      const fireInterval = activeWeaponRef.current === 'primary' ? 0.11 : 0.2;
      if (now - lastFireTime.current >= fireInterval) {
        if (isHealingRef.current) return;
        lastFireTime.current = now;
        fireOneBullet();
      }
    }

    // ------------------------------------------
    // 6.X 鏡頭受爆炸波及震動 (Camera Shake)
    // ------------------------------------------
    if (shakeAmount.current > 0.002) {
      const shake = shakeAmount.current;
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      camera.position.z += (Math.random() - 0.5) * shake;
      shakeAmount.current *= 0.88;
    }
    
    // ------------------------------------------
    // 6.1 開鏡平滑插值 (ADS Lerp) 與鏡頭 FOV 更新
    // ------------------------------------------
    adsLerp.current = THREE.MathUtils.lerp(adsLerp.current, isAds ? 1 : 0, 0.16);
    
    camera.fov = THREE.MathUtils.lerp(70, 45, adsLerp.current);
    camera.updateProjectionMatrix();

    // ------------------------------------------
    // 6.2 移動物理與滑動碰撞偵測 (Sliding AABB Collision)
    // ------------------------------------------
    const keyboardState = keys.current;
    const keysState = {
      moveForward: keyboardState.moveForward || (mobileKeysRef.current ? mobileKeysRef.current.moveForward : false),
      moveBackward: keyboardState.moveBackward || (mobileKeysRef.current ? mobileKeysRef.current.moveBackward : false),
      moveLeft: keyboardState.moveLeft || (mobileKeysRef.current ? mobileKeysRef.current.moveLeft : false),
      moveRight: keyboardState.moveRight || (mobileKeysRef.current ? mobileKeysRef.current.moveRight : false),
      jump: keyboardState.jump || (mobileKeysRef.current ? mobileKeysRef.current.jump : false),
      run: keyboardState.run || (mobileKeysRef.current ? mobileKeysRef.current.run : false),
      crouch: keyboardState.crouch || (mobileKeysRef.current ? mobileKeysRef.current.crouch : false),
    };
    const frontVector = new THREE.Vector3();
    const sideVector = new THREE.Vector3();
    const direction = new THREE.Vector3();

    camera.getWorldDirection(frontVector);
    frontVector.y = 0;
    frontVector.normalize();

    sideVector.crossVectors(frontVector, camera.up).normalize();

    if (keysState.moveForward) direction.add(frontVector);
    if (keysState.moveBackward) direction.sub(frontVector);
    if (keysState.moveRight) direction.add(sideVector);
    if (keysState.moveLeft) direction.sub(sideVector);

    direction.normalize();

    let speed = 4.8;
    if (keysState.crouch) {
      speed = 2.2; // 蹲下速度減慢
    } else if (keysState.run && !isAds) {
      speed = 9.5;
    }
    const speedMultiplier = isAds ? 0.45 : 1.0;

    const moveStep = speed * speedMultiplier * safeDelta;
    const playerRadius = 0.45;

    // 建立目前所有的碰撞體清單 (包含靜態掩體與教學靶)
    const activeColliders = [...STATIC_COLLIDERS];
    if (isTutorialRef.current) {
      activeColliders.push({ x: 0, z: 65, hx: 0.5, hz: 0.5 });
      activeColliders.push({ x: -6, z: 60, hx: 0.5, hz: 0.5 });
    }

    const baseHeight = keysState.crouch ? 0.9 : 1.6;

    // 1. 分別沿 X 軸移動並檢測碰撞
    if (direction.x !== 0) {
      camera.position.x += direction.x * moveStep;
      
      for (let i = 0; i < activeColliders.length; i++) {
        const c = activeColliders[i];
        const minX = c.x - c.hx - playerRadius;
        const maxX = c.x + c.hx + playerRadius;
        const minZ = c.z - c.hz - playerRadius;
        const maxZ = c.z + c.hz + playerRadius;

        const playerFeetY = camera.position.y - baseHeight;
        const playerHeadY = camera.position.y;
        const minY = c.minY !== undefined ? c.minY : 0;
        const maxY = c.maxY !== undefined ? c.maxY : Infinity;
        const yOverlap = playerHeadY >= minY && playerFeetY <= maxY;

        if (yOverlap &&
            camera.position.x > minX && camera.position.x < maxX &&
            camera.position.z > minZ && camera.position.z < maxZ) {
          // 碰撞發生！將玩家 X 座標推回最近的邊界
          const distLeft = camera.position.x - minX;
          const distRight = maxX - camera.position.x;
          if (distLeft < distRight) {
            camera.position.x = minX;
          } else {
            camera.position.x = maxX;
          }
        }
      }
    }
    camera.position.x = Math.max(-mapLimit, Math.min(mapLimit, camera.position.x));

    // 2. 分別沿 Z 軸移動並檢測碰撞
    if (direction.z !== 0) {
      camera.position.z += direction.z * moveStep;
      
      for (let i = 0; i < activeColliders.length; i++) {
        const c = activeColliders[i];
        const minX = c.x - c.hx - playerRadius;
        const maxX = c.x + c.hx + playerRadius;
        const minZ = c.z - c.hz - playerRadius;
        const maxZ = c.z + c.hz + playerRadius;

        const playerFeetY = camera.position.y - baseHeight;
        const playerHeadY = camera.position.y;
        const minY = c.minY !== undefined ? c.minY : 0;
        const maxY = c.maxY !== undefined ? c.maxY : Infinity;
        const yOverlap = playerHeadY >= minY && playerFeetY <= maxY;

        if (yOverlap &&
            camera.position.x > minX && camera.position.x < maxX &&
            camera.position.z > minZ && camera.position.z < maxZ) {
          // 碰撞發生！將玩家 Z 座標推回最近的邊界
          const distBottom = camera.position.z - minZ;
          const distTop = maxZ - camera.position.z;
          if (distBottom < distTop) {
            camera.position.z = minZ;
          } else {
            camera.position.z = maxZ;
          }
        }
      }
    }
    camera.position.z = Math.max(-mapLimit, Math.min(mapLimit, camera.position.z));

    // ------------------------------------------
    // 6.X 教學移動與跳躍觸發判定
    // ------------------------------------------
    if (isTutorialRef.current) {
      const isMoving = keysState.moveForward || keysState.moveBackward || keysState.moveLeft || keysState.moveRight;
      if (isMoving) {
        onTriggerTutorialRef.current('move');
        if (keysState.run && !isGrounded.current) {
          onTriggerTutorialRef.current('sprintJump');
        }
      }
    }

    // 計算當前位置下方的最高平台/斜坡高度
    let highestUnderPlayer = 0;
    for (let i = 0; i < Y_PLATFORMS.length; i++) {
      const p = Y_PLATFORMS[i];
      if (p.type === 'flat') {
        if (camera.position.x >= p.x1 && camera.position.x <= p.x2 &&
            camera.position.z >= p.z1 && camera.position.z <= p.z2) {
          if (camera.position.y >= p.y + 0.1) {
            if (p.y > highestUnderPlayer) highestUnderPlayer = p.y;
          }
        }
      } else if (p.type === 'ramp') {
        if (camera.position.x >= p.x1 && camera.position.x <= p.x2 &&
            camera.position.z >= p.z1 && camera.position.z <= p.z2) {
          let ratio;
          if (p.dir === 'z') {
            ratio = (camera.position.z - p.z1) / (p.z2 - p.z1);
          } else {
            ratio = (camera.position.x - p.x1) / (p.x2 - p.x1);
          }
          ratio = Math.max(0, Math.min(1, ratio));
          const rampY = p.y1 + (p.y2 - p.y1) * ratio;
          if (camera.position.y >= rampY + 0.1) {
            if (rampY > highestUnderPlayer) highestUnderPlayer = rampY;
          }
        }
      }
    }
    const baseGroundHeight = highestUnderPlayer;
    const targetHeight = baseGroundHeight + baseHeight;

    // 檢測玩家是否從平台/斜坡邊緣跌落 (當實際高度高於目標站立高度達 0.3 米時觸發自由落體)
    if (isGrounded.current && camera.position.y > targetHeight + 0.3) {
      isGrounded.current = false;
    }

    // 重力與跳躍
    if (!isGrounded.current) {
      velocityY.current -= 9.8 * 2.6 * safeDelta;
      camera.position.y += velocityY.current * safeDelta;

      if (camera.position.y <= targetHeight) {
        camera.position.y = targetHeight;
        velocityY.current = 0;
        isGrounded.current = true;
      }
    } else {
      // 站在平台上時，相機高度平滑插值到 targetHeight
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetHeight, 15.0 * safeDelta);
      
      if (keysState.jump && !keysState.crouch) {
        velocityY.current = 7.0;
        isGrounded.current = false;
      }
    }

    // ------------------------------------------
    // 6.3 槍枝動態擺動與後座力衰減
    // ------------------------------------------
    if (weaponRef.current) {
      weaponRef.current.position.copy(camera.position);
      weaponRef.current.rotation.copy(camera.rotation);

      const bobMultiplier = 1 - adsLerp.current * 0.85;
      const swayMultiplier = 1 - adsLerp.current * 0.8;

      // 行走起伏
      const isMoving = keysState.moveForward || keysState.moveBackward || keysState.moveLeft || keysState.moveRight;
      const time = state.clock.getElapsedTime();
      
      let bobbingX = 0;
      let bobbingY = 0;

      if (isMoving && isGrounded.current) {
        const frequency = (keysState.run && !isAds) ? 14 : 9.5;
        const ampX = (keysState.run && !isAds) ? 0.025 : 0.014;
        const ampY = (keysState.run && !isAds) ? 0.022 : 0.014;
        
        bobbingX = Math.sin(time * frequency) * ampX * bobMultiplier;
        bobbingY = Math.cos(time * frequency * 2) * ampY * bobMultiplier;
      }

      // 視角旋轉晃動
      const rotationDeltaY = camera.rotation.y - prevRotation.current.y;
      const rotationDeltaX = camera.rotation.x - prevRotation.current.x;
      prevRotation.current.copy(camera.rotation);

      const swayScale = 0.42;
      weaponTargetOffset.current.x = -rotationDeltaY * swayScale * swayMultiplier;
      weaponTargetOffset.current.y = -rotationDeltaX * swayScale * swayMultiplier;

      const maxSway = isAds ? 0.01 : 0.045;
      weaponTargetOffset.current.x = Math.max(-maxSway, Math.min(maxSway, weaponTargetOffset.current.x));
      weaponTargetOffset.current.y = Math.max(-maxSway, Math.min(maxSway, weaponTargetOffset.current.y));

      weaponOffset.current.lerp(weaponTargetOffset.current, 0.12);

      // 後座力衰減
      recoilOffset.current = THREE.MathUtils.lerp(recoilOffset.current, 0, 0.15);

      // ------------------------------------------
      // 6.4 計算槍身位置 (開鏡 Z 前推 -0.14m，使槍托隱形，並將鏡筒中心 Y 對齊 -0.0754m)
      // ------------------------------------------
      const currentX = THREE.MathUtils.lerp(0.23, 0.0, adsLerp.current);
      const currentY = THREE.MathUtils.lerp(-0.23, -0.0754, adsLerp.current);
      const currentZ = THREE.MathUtils.lerp(-0.52, -0.14, adsLerp.current);

      weaponRef.current.translateZ(currentZ + recoilOffset.current);
      weaponRef.current.translateX(currentX + bobbingX + weaponOffset.current.x);
      weaponRef.current.translateY(currentY + bobbingY + weaponOffset.current.y);
    }
  });

  return null;
}
// 7. 遊戲主架構 App Component
// ==========================================
export default function App() {
  const [gameState, setGameState] = useState('deploying');
  const [isLocked, setIsLocked] = useState(false);
  const [device, setDevice] = useState(null); // null, 'pc', 'mobile'

  // ==========================================
  // 帳號系統狀態 (Account System States)
  // ==========================================
  const [currentUser, setCurrentUser] = useState(null);
  const [authTab, setAuthTab] = useState('login'); // 'login' or 'register'
  const [authForm, setAuthForm] = useState({
    username: '',
    nickname: '',
    password: '',
    confirmPassword: '',
  });
  const [authError, setAuthError] = useState('');
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [endgameStats, setEndgameStats] = useState(null);
  const [lobbyTab, setLobbyTab] = useState('stats'); // 'stats' or 'shop'

  // 載入與同步本機排行榜
  const leaderboard = useMemo(() => {
    return getLeaderboard();
  }, [currentUser, gameState]);

  // 單場戰績即時統計
  const runStatsRef = useRef({
    shotsFired: 0,
    shotsHit: 0,
    headshots: 0,
    startTime: 0,
  });


  // 開鏡瞄準 (ADS) 的 React 狀態
  const [isAds, setIsAds] = useState(false);

  // 行動端專屬狀態
  const [mobileFiring, setMobileFiring] = useState(false);
  const [mobileGrenadeTrigger, setMobileGrenadeTrigger] = useState(0);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [mobileCrouch, setMobileCrouch] = useState(false);
  const mobileKeysRef = useRef({
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    run: false,
    jump: false,
    crouch: false,
  });

  // 主副武器切換、彈藥與射擊模式狀態
  const [activeWeapon, setActiveWeapon] = useState('primary'); // 'primary' or 'secondary'
  const [primaryAmmo, setPrimaryAmmo] = useState(30);
  const [secondaryAmmo, setSecondaryAmmo] = useState(15);
  const [primaryFireMode, setPrimaryFireMode] = useState('auto');
  const reloadTimeoutRef = useRef(null);

  // 衍生狀態
  const fireMode = activeWeapon === 'primary' ? primaryFireMode : 'semi';
  const ammo = activeWeapon === 'primary' ? primaryAmmo : secondaryAmmo;
  const setAmmo = activeWeapon === 'primary' ? setPrimaryAmmo : setSecondaryAmmo;

  // 戰術裝備與拋殼實體狀態
  const [grenades, setGrenades] = useState(2);
  const [grenadeEntities, setGrenadeEntities] = useState([]);
  const [casings, setCasings] = useState([]);
  const [droppedMags, setDroppedMags] = useState([]);
  const [shakeTrigger, setShakeTrigger] = useState(0);

  // 玩家戰術數據
  const [health, setHealth] = useState(100);
  const [isReloading, setIsReloading] = useState(false);
  const [isHealing, setIsHealing] = useState(false);
  const [healProgress, setHealProgress] = useState(0);
  const healTimeoutRef = useRef(null);
  const healIntervalRef = useRef(null);
  const [eliminated, setEliminated] = useState(0);

  // 畫面閃紅受傷特效狀態
  const [hurtActive, setHurtActive] = useState(false);

  // 敵人、粒子特效、彈孔貼紙狀態
  const [enemies, setEnemies] = useState(() => spawnEnemies(false));
  const [particles, setParticles] = useState([]);
  const [holes, setHoles] = useState([]);
  
  // 相機重置觸發器
  const [resetTrigger, setResetTrigger] = useState(0);

  // 戰術擊殺訊息與命中標記狀態
  const [killFeed, setKillFeed] = useState([]);
  const [hitMarker, setHitMarker] = useState({ visible: false, isHeadshot: false });
  const [nearStation, setNearStation] = useState(null); // 'ammo', 'med', or null

  // 補給站冷卻時間
  const [ammoCooldown, setAmmoCooldown] = useState(0);
  const [medCooldown, setMedCooldown] = useState(0);

  // 新手互動教學狀態
  const [isTutorial, setIsTutorial] = useState(false);
  const [tutorialChecklist, setTutorialChecklist] = useState({
    move: false,
    sprintJump: false,
    fireMode: false,
    shoot: false,
    headshot: false,
    grenade: false,
    refill: false,
  });

  const hitMarkerTimer = useRef(null);

  // 輔助函式：觸發教學清單項完成
  const triggerTutorialStep = (stepName) => {
    setTutorialChecklist((prev) => {
      if (prev[stepName] === true) return prev;
      soundManager.playSuccessChime(); // 播放完成「叮咚」音
      return {
        ...prev,
        [stepName]: true,
      };
    });
  };

  // 補給站冷卻倒數計時
  useEffect(() => {
    if (ammoCooldown > 0) {
      const timer = setTimeout(() => setAmmoCooldown(ammoCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [ammoCooldown]);

  useEffect(() => {
    if (medCooldown > 0) {
      const timer = setTimeout(() => setMedCooldown(medCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [medCooldown]);

  const controlsRef = useRef();
  const gunRef = useRef();
  const muzzleFlashRef = useRef();

  // 防止瀏覽器右鍵選單彈出
  useEffect(() => {
    const handleContextMenu = (e) => {
      e.preventDefault();
    };
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  // 游標解鎖時，強迫解除開鏡狀態
  useEffect(() => {
    if (!isLocked) {
      setIsAds(false);
    }
  }, [isLocked]);

  // ==========================================
  // 行動端與鍵盤觸發器重構 Restructured Triggers
  // ==========================================
  const triggerWeaponSwitch = () => {
    if (gameState !== 'active' || isHealing) return;
    if (isReloading) {
      setIsReloading(false);
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    }
    setActiveWeapon((prev) => (prev === 'primary' ? 'secondary' : 'primary'));
    soundManager.playWeaponSwitch();
  };

  const triggerReload = () => {
    if (gameState !== 'active' || isReloading || isHealing) return;
    const currentAmmo = activeWeapon === 'primary' ? primaryAmmo : secondaryAmmo;
    const maxAmmo = activeWeapon === 'primary' ? 30 : 15;
    if (currentAmmo < maxAmmo) {
      setIsReloading(true);
      if (activeWeapon === 'primary') {
        soundManager.playReload();
      } else {
        soundManager.playPistolReload();
      }
      reloadTimeoutRef.current = setTimeout(() => {
        if (activeWeapon === 'primary') {
          setPrimaryAmmo(30);
        } else {
          setSecondaryAmmo(15);
        }
        setIsReloading(false);
      }, activeWeapon === 'primary' ? 1500 : 1000);
    }
  };

  const triggerHeal = () => {
    if (gameState !== 'active' || isHealing || isReloading) return;
    if (health >= 100) return;
    
    setIsAds(false); // 補血時強迫解除開鏡
    setIsHealing(true);
    setHealProgress(0);
    soundManager.playHeal();
    
    if (healIntervalRef.current) clearInterval(healIntervalRef.current);
    if (healTimeoutRef.current) clearTimeout(healTimeoutRef.current);
    
    let progress = 0;
    const duration = 2000; // 2秒補血動作
    const intervalTime = 50;
    const step = (intervalTime / duration) * 100;
    
    healIntervalRef.current = setInterval(() => {
      progress += step;
      if (progress >= 100) {
        clearInterval(healIntervalRef.current);
        setHealProgress(100);
      } else {
        setHealProgress(progress);
      }
    }, intervalTime);

    healTimeoutRef.current = setTimeout(() => {
      setHealth(100);
      setIsHealing(false);
      setHealProgress(0);
      soundManager.playSuccessChime();
    }, duration);
  };

  const triggerFireMode = () => {
    if (gameState !== 'active') return;
    if (activeWeapon === 'secondary') return; // M9 鎖定半自動
    setPrimaryFireMode((prev) => {
      const next = prev === 'auto' ? 'semi' : 'auto';
      if (isTutorial) triggerTutorialStep('fireMode');
      return next;
    });
  };

  // 監聽 1 鍵與 2 鍵切換主副武器
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gameState !== 'active' || !isLocked || isHealing) return;
      if (e.code === 'Digit1' && activeWeapon !== 'primary') {
        triggerWeaponSwitch();
      } else if (e.code === 'Digit2' && activeWeapon !== 'secondary') {
        triggerWeaponSwitch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, isLocked, activeWeapon, isHealing]);

  // 監聽 R 鍵重新裝彈，播放合成重新裝彈聲
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gameState !== 'active' || !isLocked || isReloading || isHealing) return;
      if (e.code === 'KeyR') {
        triggerReload();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, isLocked, isReloading, isHealing, activeWeapon, primaryAmmo, secondaryAmmo]);

  // 單獨的 useEffect 確保 App 元件卸載時清除 reload/heal timeout
  useEffect(() => {
    return () => {
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
      if (healTimeoutRef.current) clearTimeout(healTimeoutRef.current);
      if (healIntervalRef.current) clearInterval(healIntervalRef.current);
    };
  }, []);

  // 監聽遊戲狀態，非 active 時重置並清除所有補血定時器
  useEffect(() => {
    if (gameState !== 'active') {
      if (healIntervalRef.current) {
        clearInterval(healIntervalRef.current);
        healIntervalRef.current = null;
      }
      if (healTimeoutRef.current) {
        clearTimeout(healTimeoutRef.current);
        healTimeoutRef.current = null;
      }
      setIsHealing(false);
      setHealProgress(0);
    }
  }, [gameState]);

  // 監聽 5 鍵使用醫療包補血
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gameState !== 'active' || !isLocked || isHealing || isReloading) return;
      if (e.code === 'Digit5' || e.code === 'Numpad5') {
        triggerHeal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, isLocked, isHealing, isReloading, health]);

  // 監聽 B 鍵切換射擊模式 (連發/單發)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyB' && gameState === 'active' && isLocked) {
        triggerFireMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, isLocked, isTutorial, activeWeapon]);

  // 監聽受傷效果定時關閉
  useEffect(() => {
    if (hurtActive) {
      const timer = setTimeout(() => {
        setHurtActive(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [hurtActive]);

  // 表單輸入處理
  const handleAuthInputChange = (e) => {
    const { name, value } = e.target;
    setAuthForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // 執行登入
  const handleLogin = (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const user = loginAccount(authForm.username, authForm.password);
      setCurrentUser(user);
      setNewNickname(user.nickname);
      setAuthForm({ username: '', nickname: '', password: '', confirmPassword: '' });
    } catch (err) {
      setAuthError(err.message);
    }
  };

  // 執行註冊
  const handleRegister = (e) => {
    e.preventDefault();
    setAuthError('');
    if (authForm.password !== authForm.confirmPassword) {
      setAuthError('兩次密碼輸入不一致！');
      return;
    }
    try {
      const user = registerAccount(authForm.username, authForm.nickname, authForm.password);
      setCurrentUser(user);
      setNewNickname(user.nickname);
      setAuthForm({ username: '', nickname: '', password: '', confirmPassword: '' });
    } catch (err) {
      setAuthError(err.message);
    }
  };

  // 修改暱稱
  const handleSaveNickname = () => {
    if (!newNickname.trim()) return;
    try {
      const updated = updateNickname(currentUser.username, newNickname);
      setCurrentUser(updated);
      setIsEditingNickname(false);
    } catch (err) {
      alert(err.message);
    }
  };

  // 登出
  const handleLogout = () => {
    setCurrentUser(null);
    setNewNickname('');
    setIsEditingNickname(false);
    setLobbyTab('stats');
  };

  // 購買裝備商品
  const handleBuyItem = (itemId) => {
    if (!currentUser) return;
    if (currentUser.isGuest) {
      const item = SHOP_ITEMS.find(i => i.id === itemId);
      if (!item) return;
      const currentCoins = currentUser.coins !== undefined ? currentUser.coins : 0;
      if (currentCoins < item.cost) {
        alert('遊客 Delta 金幣不足！（您可以透過實戰演練賺取金幣）');
        return;
      }
      const updatedUser = {
        ...currentUser,
        coins: currentCoins - item.cost,
        inventory: {
          ...(currentUser.inventory || { laserSight: false, suppressor: false, bodyArmor: false, grenadePouch: false, opsHelmet: false }),
          [itemId]: true
        }
      };
      setCurrentUser(updatedUser);
      return;
    }

    try {
      const updated = purchaseItem(currentUser.username, itemId);
      setCurrentUser(updated);
    } catch (err) {
      alert(err.message);
    }
  };

  // 儲存結算數據至本機資料庫
  const saveEndgameStats = (victory, killsOverride = null) => {
    const finalKills = killsOverride !== null ? killsOverride : eliminated;
    const playTimeSeconds = Math.max(1, Math.round((Date.now() - runStatsRef.current.startTime) / 1000));
    const runStats = {
      victory,
      kills: finalKills,
      headshots: runStatsRef.current.headshots,
      shotsFired: runStatsRef.current.shotsFired,
      shotsHit: runStatsRef.current.shotsHit,
      playTimeSeconds
    };
    
    // 計算金幣（適用於遊客/登入用戶顯示）
    const killsCoins = finalKills * 50;
    const victoryCoins = victory ? 300 : 0;
    const headshotsCoins = runStatsRef.current.headshots * 20;
    const accuracyPct = runStatsRef.current.shotsFired > 0 ? (runStatsRef.current.shotsHit / runStatsRef.current.shotsFired) : 0;
    const accuracyCoins = Math.round(accuracyPct * 100);
    const totalCoins = killsCoins + victoryCoins + headshotsCoins + accuracyCoins;
    
    const coinsEarnedDetails = {
      killsCoins,
      victoryCoins,
      headshotsCoins,
      accuracyCoins,
      total: totalCoins
    };

    if (!currentUser || isTutorial) {
      setEndgameStats({
        ...runStats,
        coinsEarnedDetails
      });
      return;
    }

    if (currentUser.isGuest) {
      // 遊客模式：也累積金幣（暫存於 State，登出消失）
      const updatedUser = {
        ...currentUser,
        coins: (currentUser.coins !== undefined ? currentUser.coins : 0) + totalCoins
      };
      setCurrentUser(updatedUser);
      setEndgameStats({
        ...runStats,
        coinsEarnedDetails
      });
      return;
    }

    const result = updateStats(currentUser.username, runStats);
    if (result) {
      setCurrentUser(result.user);
      setEndgameStats({
        ...runStats,
        coinsEarnedDetails: result.coinsEarnedDetails
      });
    } else {
      setEndgameStats({
        ...runStats,
        coinsEarnedDetails
      });
    }
  };

  // 點擊「DEPLOY」按鈕進入遊戲並鎖定滑鼠
  const handleDeploy = () => {
    setEndgameStats(null);
    runStatsRef.current = { shotsFired: 0, shotsHit: 0, headshots: 0, startTime: Date.now() };
    
    // 套用戰術裝備升級
    const hasArmor = currentUser && currentUser.inventory && currentUser.inventory.bodyArmor;
    const hasGrenadePouch = currentUser && currentUser.inventory && currentUser.inventory.grenadePouch;
    setHealth(hasArmor ? 150 : 100);
    setGrenades(hasGrenadePouch ? 3 : 2);

    setGameState('active');
    soundManager.startAmbient();

    setTimeout(() => {
      if (device === 'mobile') {
        setIsLocked(true);
      } else if (controlsRef.current) {
        controlsRef.current.lock();
      }
    }, 50);
  };

  // 實體拋殼與彈匣掉落輔助生成函式
  const addCasing = (position, velocity) => {
    const id = Math.random();
    setCasings((prev) => {
      const newList = [...prev, { id, position, velocity }];
      if (newList.length > 25) newList.shift(); // 限制數量維持效能
      return newList;
    });
  };

  const addDroppedMag = (position, velocity) => {
    const id = Math.random();
    setDroppedMags((prev) => {
      const newList = [...prev, { id, position, velocity }];
      if (newList.length > 5) newList.shift();
      return newList;
    });
  };

  const addGrenade = (position, velocity) => {
    const id = Math.random();
    setGrenadeEntities((prev) => [...prev, { id, position, velocity }]);
    if (isTutorial) triggerTutorialStep('grenade');
  };

  // 輔助函式：發送戰術擊殺訊息
  const addKillFeedEntry = (message, type) => {
    const id = Math.random();
    setKillFeed((prev) => {
      const newList = [...prev, { id, message, type }];
      if (newList.length > 4) newList.shift(); // 限制最多顯示 4 筆
      return newList;
    });

    // 4.5 秒後自動淡出移除
    setTimeout(() => {
      setKillFeed((prev) => prev.filter((item) => item.id !== id));
    }, 4500);
  };

  // 輔助函式：觸發準星命中反饋
  const triggerHitMarker = (isHeadshot) => {
    if (hitMarkerTimer.current) clearTimeout(hitMarkerTimer.current);
    setHitMarker({ visible: true, isHeadshot });
    hitMarkerTimer.current = setTimeout(() => {
      setHitMarker({ visible: false, isHeadshot: false });
    }, 200);
  };

  // 補給箱與醫療站互動執行邏輯
  const handleInteractAmmo = () => {
    if (ammoCooldown > 0) return;
    setPrimaryAmmo(30);
    setSecondaryAmmo(15);
    setGrenades(2);
    soundManager.playRefillAmmo();
    setAmmoCooldown(15); // 15秒冷卻
    if (isTutorial) triggerTutorialStep('refill');
  };

  const handleInteractMed = () => {
    if (medCooldown > 0) return;
    setHealth(100);
    soundManager.playHeal();
    setMedCooldown(15); // 15秒冷卻
  };

  // 手榴彈倒數結束爆炸判定
  const handleExplodeGrenade = (id, explosionPoint) => {
    // 1. 播放合成爆炸音效
    soundManager.playExplosion();

    // 2. 移除該手榴彈實體
    setGrenadeEntities((prev) => prev.filter((g) => g.id !== id));

    // 3. 生成大範圍橘灰相間火焰與塵土微粒
    const explosionParticles = [];
    for (let i = 0; i < 35; i++) {
      const pId = Math.random();
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 8.5,
        Math.random() * 8.5,
        (Math.random() - 0.5) * 8.5
      );
      explosionParticles.push({
        id: pId,
        position: explosionPoint.clone(),
        velocity,
        color: Math.random() > 0.45 ? '#d97706' : '#6b7280', // 橘色火焰或灰色塵土
      });
    }

    setParticles((prev) => {
      const combined = [...prev, ...explosionParticles];
      if (combined.length > 80) combined.splice(0, combined.length - 80);
      return combined;
    });

    setTimeout(() => {
      const pIds = explosionParticles.map((p) => p.id);
      setParticles((prev) => prev.filter((p) => !pIds.includes(p.id)));
    }, 1200);

    // 4. 觸發鏡頭劇烈抖動
    setShakeTrigger((prev) => prev + 1);

    // 5. 範圍傷害判定：敵軍與玩家
    // 敵軍傷害 (半徑 8 米，距離越近傷害越高)
    setEnemies((prev) => {
      return prev.map((enemy) => {
        if (enemy.state === 'alive') {
          const dist = enemy.position.distanceTo(explosionPoint);
          if (dist < 8.0) {
            const damage = Math.max(0, Math.round(100 * (1 - dist / 8.0)));
            const newHp = Math.max(0, enemy.hp - damage);
            const isDead = newHp <= 0;
            if (isDead) {
              soundManager.playEnemyDeath(); // 播放敵軍死亡聲音
              addKillFeedEntry(`PLAYER ➔ [GRENADE] ENEMY_0${enemy.id}`, 'grenade');
            }
            return {
              ...enemy,
              hp: newHp,
              state: isDead ? 'dying' : 'alive',
            };
          }
        }
        return enemy;
      });
    });

    // 玩家自傷判定 (半徑 6 米)
    if (gunRef.current) {
      const playerPos = gunRef.current.position;
      const distToPlayer = playerPos.distanceTo(explosionPoint);
      if (distToPlayer < 6.0) {
        const damage = Math.max(0, Math.round(80 * (1 - distToPlayer / 6.0)));
        if (damage > 0) {
          setHealth((prev) => {
            const newHp = Math.max(0, prev - damage);
            if (newHp <= 0) {
              setGameState('failed');
              soundManager.stopAmbient(); // 停止基地背景音
              if (controlsRef.current) {
                controlsRef.current.unlock();
              }
              saveEndgameStats(false); // 儲存自爆失敗戰績
            }
            return newHp;
          });
          setHurtActive(true);
          soundManager.playPlayerHurt(); // 播放受傷聲音
        }
      }
    }
  };

  // 擊中環境時生成彈孔與噴砂微粒的函式
  const addImpactEffect = (point, normal) => {
    const id = Math.random();

    // 1. 生成微型彈孔
    setHoles((prev) => {
      const newHoles = [...prev, { id, position: point.clone(), normal: normal.clone() }];
      if (newHoles.length > 25) newHoles.shift();
      return newHoles;
    });

    // 2. 生成一組向外飛散的微粒
    const isGround = point.y < 0.15;
    const particleColor = isGround ? '#8b7b63' : '#555c50';

    const newParticles = [];
    for (let i = 0; i < 6; i++) {
      const pId = Math.random();
      const velocity = normal.clone().multiplyScalar(2.2 + Math.random() * 2.2);
      velocity.x += (Math.random() - 0.5) * 1.8;
      velocity.y += (Math.random() - 0.5) * 1.8;
      velocity.z += (Math.random() - 0.5) * 1.8;

      newParticles.push({
        id: pId,
        position: point.clone(),
        velocity,
        color: particleColor,
      });
    }

    setParticles((prev) => {
      const combined = [...prev, ...newParticles];
      if (combined.length > 60) combined.splice(0, combined.length - 60);
      return combined;
    });

    setTimeout(() => {
      const pIds = newParticles.map((p) => p.id);
      setParticles((prev) => prev.filter((p) => !pIds.includes(p.id)));
    }, 800);
  };

  // 擊中敵人時扣血與擊殺判定
  const handleHitEnemy = (enemyId, hitPoint, isHeadshot) => {
    addImpactEffect(hitPoint, new THREE.Vector3(0, 1, 0));

    // 顯示命中反饋 (Hit Marker)
    triggerHitMarker(isHeadshot);

    // 如果是爆頭，播放專屬金屬敲擊聲
    if (isHeadshot) {
      soundManager.playHeadshotPing();
      if (isTutorial) triggerTutorialStep('headshot');
    }

    if (isTutorial) triggerTutorialStep('shoot');

    setEnemies((prev) => {
      return prev.map((enemy) => {
        if (enemy.id === enemyId && enemy.state === 'alive') {
          const hasLaser = currentUser && currentUser.inventory && currentUser.inventory.laserSight;
          const hasSuppressor = currentUser && currentUser.inventory && currentUser.inventory.suppressor;
          const primaryDmg = hasLaser ? 30 : 25;
          const secondaryDmg = hasSuppressor ? 20 : 15;
          const damage = isHeadshot ? 100 : (activeWeapon === 'primary' ? primaryDmg : secondaryDmg);
          const newHp = Math.max(0, enemy.hp - damage);
          const isDead = newHp <= 0;
          if (isDead) {
            soundManager.playEnemyDeath(); // 播放倒地哀嚎聲
            // 寫入戰術擊殺訊息欄
            addKillFeedEntry(`PLAYER ➔ [${isHeadshot ? 'HEADSHOT' : (activeWeapon === 'primary' ? 'M4A1' : 'M9')}] ENEMY_0${enemy.id}`, isHeadshot ? 'headshot' : 'normal');
          }
          return {
            ...enemy,
            hp: newHp,
            state: isDead ? 'dying' : 'alive',
          };
        }
        return enemy;
      });
    });
  };

  // 敵軍倒地動畫完成後被徹底銷毀
  const handleEnemyKilled = (enemyId) => {
    if (isTutorial) {
      // 教學模式下，靶子倒地後 1.2 秒原地復活重設
      setTimeout(() => {
        setEnemies((prev) => {
          return prev.map((enemy) => {
            if (enemy.id === enemyId) {
              return {
                ...enemy,
                hp: 100,
                state: 'alive'
              };
            }
            return enemy;
          });
        });
      }, 1200);
      return;
    }

    setEnemies((prev) => prev.filter((enemy) => enemy.id !== enemyId));
    setEliminated((prev) => {
      const newCount = prev + 1;
      
      if (newCount >= 12) {
        setGameState('victory');
        soundManager.stopAmbient(); // 勝利時關閉背景環境音
        if (controlsRef.current) {
          controlsRef.current.unlock();
        }
        saveEndgameStats(true, newCount); // 儲存勝利戰績
      }
      return newCount;
    });
  };

  // 敵軍定時向玩家開火扣血 (接受不同兵種的傷害值)
  const handleShootPlayer = (damage = 10) => {
    if (gameState !== 'active') return;

    const hasHelmet = currentUser && currentUser.inventory && currentUser.inventory.opsHelmet;
    const finalDamage = hasHelmet ? Math.max(1, Math.round(damage * 0.75)) : damage;

    setHealth((prev) => {
      const newHp = Math.max(0, prev - finalDamage);
      
      if (newHp <= 0) {
        setGameState('failed');
        soundManager.stopAmbient(); // 失敗時關閉背景環境音
        if (controlsRef.current) {
          controlsRef.current.unlock();
        }
        saveEndgameStats(false); // 儲存戰死失敗戰績
      }
      return newHp;
    });

    setHurtActive(true);
    soundManager.playPlayerHurt(); // 播放玩家受傷聲音
  };

  // 重新開始/部署遊戲
  const handleRestart = () => {
    setEndgameStats(null);
    runStatsRef.current = { shotsFired: 0, shotsHit: 0, headshots: 0, startTime: Date.now() };
    
    // 套用戰術裝備升級
    const hasArmor = currentUser && currentUser.inventory && currentUser.inventory.bodyArmor;
    const hasGrenadePouch = currentUser && currentUser.inventory && currentUser.inventory.grenadePouch;
    setHealth(hasArmor ? 150 : 100);
    setPrimaryAmmo(30);
    setSecondaryAmmo(15);
    setActiveWeapon('primary');
    if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    setIsReloading(false);
    if (healTimeoutRef.current) clearTimeout(healTimeoutRef.current);
    if (healIntervalRef.current) clearInterval(healIntervalRef.current);
    setIsHealing(false);
    setHealProgress(0);
    setEliminated(0);
    setEnemies(spawnEnemies(isTutorial)); // 依照當前是否為教學模式生成對應敵軍或標靶
    setHoles([]);
    setParticles([]);
    setIsAds(false);
    setPrimaryFireMode('auto');
    setGrenades(hasGrenadePouch ? 3 : 2);
    setGrenadeEntities([]);
    setCasings([]);
    setDroppedMags([]);
    setResetTrigger((prev) => prev + 1);
    setGameState('active');

    // 重置物資站狀態與擊殺日誌
    setKillFeed([]);
    setAmmoCooldown(0);
    setMedCooldown(0);
    setNearStation(null);

    // 若在教學模式，重置清單
    if (isTutorial) {
      setTutorialChecklist({
        move: false,
        sprintJump: false,
        fireMode: false,
        shoot: false,
        headshot: false,
        grenade: false,
        refill: false,
      });
    }
    
    soundManager.startAmbient(); // 重啟基地背景音

    setTimeout(() => {
      if (device === 'mobile') {
        setIsLocked(true);
      } else if (controlsRef.current) {
        controlsRef.current.lock();
      }
    }, 50);
  };

  // 進入新手互動教學模式
  const handleStartTutorial = () => {
    setEndgameStats(null);
    runStatsRef.current = { shotsFired: 0, shotsHit: 0, headshots: 0, startTime: Date.now() };
    setIsTutorial(true);
    setTutorialChecklist({
      move: false,
      sprintJump: false,
      fireMode: false,
      shoot: false,
      headshot: false,
      grenade: false,
      refill: false,
    });
    setHealth(100);
    setPrimaryAmmo(30);
    setSecondaryAmmo(15);
    setActiveWeapon('primary');
    if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    setIsReloading(false);
    setEliminated(0);
    setEnemies(spawnEnemies(true)); // 生成訓練標靶 Dummy
    setHoles([]);
    setParticles([]);
    setIsAds(false);
    setPrimaryFireMode('auto');
    setGrenades(2);
    setGrenadeEntities([]);
    setCasings([]);
    setDroppedMags([]);
    setResetTrigger((prev) => prev + 1);
    setGameState('active');

    soundManager.startAmbient();

    setTimeout(() => {
      if (device === 'mobile') {
        setIsLocked(true);
      } else if (controlsRef.current) {
        controlsRef.current.lock();
      }
    }, 50);
  };

  // 教學完成後進入實戰
  const handleDeployFromTutorial = () => {
    setEndgameStats(null);
    runStatsRef.current = { shotsFired: 0, shotsHit: 0, headshots: 0, startTime: Date.now() };
    setIsTutorial(false);
    // 重啟進入正式實戰模式
    const hasArmor = currentUser && currentUser.inventory && currentUser.inventory.bodyArmor;
    const hasGrenadePouch = currentUser && currentUser.inventory && currentUser.inventory.grenadePouch;
    setHealth(hasArmor ? 150 : 100);
    setPrimaryAmmo(30);
    setSecondaryAmmo(15);
    setActiveWeapon('primary');
    if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    setIsReloading(false);
    setEliminated(0);
    setEnemies(spawnEnemies(false));
    setHoles([]);
    setParticles([]);
    setIsAds(false);
    setPrimaryFireMode('auto');
    setGrenades(hasGrenadePouch ? 3 : 2);
    setGrenadeEntities([]);
    setCasings([]);
    setDroppedMags([]);
    setResetTrigger((prev) => prev + 1);
    setGameState('active');

    setKillFeed([]);
    setAmmoCooldown(0);
    setMedCooldown(0);
    setNearStation(null);

    soundManager.startAmbient();

    setTimeout(() => {
      if (device === 'mobile') {
        setIsLocked(true);
      } else if (controlsRef.current) {
        controlsRef.current.lock();
      }
    }, 50);
  };

  // 教學完成後返回大廳
  const handleReturnToLobby = () => {
    setIsTutorial(false);
    setGameState('deploying');
    if (device === 'mobile') {
      setIsLocked(false);
    } else if (controlsRef.current) {
      controlsRef.current.unlock();
    }
  };

  // 監聽教學任務全部完成時，自動解鎖游標
  useEffect(() => {
    if (isTutorial && Object.values(tutorialChecklist).every((val) => val === true)) {
      if (device === 'mobile') {
        setIsLocked(false);
      } else if (controlsRef.current) {
        controlsRef.current.unlock();
      }
    }
  }, [tutorialChecklist, isTutorial, device]);

  // 勝利或失敗狀態下，按 R 鍵亦能快速重新部署
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyR') {
        if (gameState === 'victory' || gameState === 'failed') {
          handleRestart();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState]);

  // ==========================================
  // 行動端虛擬搖桿事件處理 Joystick Touch Handlers
  // ==========================================
  const joystickTouchId = useRef(null);
  const joystickCenter = useRef({ x: 0, y: 0 });
  const joystickRadius = useRef(50);

  const handleJoystickStart = (e) => {
    if (joystickTouchId.current !== null) return;
    const touch = e.changedTouches[0];
    joystickTouchId.current = touch.identifier;

    const rect = e.currentTarget.getBoundingClientRect();
    joystickCenter.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    joystickRadius.current = rect.width / 2;
  };

  const handleJoystickMove = (e) => {
    if (joystickTouchId.current === null) return;
    
    let touch = null;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === joystickTouchId.current) {
        touch = e.touches[i];
        break;
      }
    }
    if (!touch) return;

    let dx = touch.clientX - joystickCenter.current.x;
    let dy = touch.clientY - joystickCenter.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = joystickRadius.current;

    if (dist > maxDist) {
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }

    setJoystickPos({ x: dx, y: dy });

    const nx = dx / maxDist;
    const ny = dy / maxDist;

    // 映射到移動按鍵 mapping to movement keys
    mobileKeysRef.current.moveLeft = nx < -0.25;
    mobileKeysRef.current.moveRight = nx > 0.25;
    mobileKeysRef.current.moveForward = ny < -0.25;
    mobileKeysRef.current.moveBackward = ny > 0.25;

    // 行動端奔跑判定 (推到底時跑) mobile sprint trigger
    mobileKeysRef.current.run = (ny < -0.75 && Math.abs(nx) < 0.5);
  };

  const handleJoystickEnd = (e) => {
    if (joystickTouchId.current === null) return;
    
    let isEnd = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joystickTouchId.current) {
        isEnd = true;
        break;
      }
    }

    if (isEnd) {
      joystickTouchId.current = null;
      setJoystickPos({ x: 0, y: 0 });
      mobileKeysRef.current.moveLeft = false;
      mobileKeysRef.current.moveRight = false;
      mobileKeysRef.current.moveForward = false;
      mobileKeysRef.current.moveBackward = false;
      mobileKeysRef.current.run = false;
    }
  };

  const isTutorialComplete = isTutorial && Object.values(tutorialChecklist).every((val) => val === true);

  return (
    <>
      {/* 戰術 CRT 掃描線 */}
      <div className="crt-overlay" />

      {/* 受傷閃紅疊加層 */}
      <div className={`hurt-overlay ${hurtActive ? 'active' : ''}`} />

      {/* 補血閃綠疊加層 */}
      <div className={`heal-overlay ${isHealing ? 'active' : ''}`} />

      {/* 補血進度條 HUD */}
      {isHealing && (
        <div className="hud-healing-overlay">
          <div className="hud-healing-label">HEALING...</div>
          <div className="hud-healing-bar-container">
            <div className="hud-healing-bar" style={{ width: `${healProgress}%` }} />
          </div>
          <div className="hud-healing-pct">{Math.round(healProgress)}%</div>
        </div>
      )}

      {/* 左側教學進度清單面板 */}
      {isTutorial && gameState !== 'deploying' && (
        <div className="tutorial-panel">
          <h3>TUTORIAL PROGRESS</h3>
          <div className={`checklist-item ${tutorialChecklist.move ? 'completed' : ''}`}>
            <div className="checklist-checkbox">{tutorialChecklist.move ? '✔' : ''}</div>
            <span>{device === 'pc' ? 'WASD 移動控制' : '虛擬搖桿 移動控制'}</span>
          </div>
          <div className={`checklist-item ${tutorialChecklist.sprintJump ? 'completed' : ''}`}>
            <div className="checklist-checkbox">{tutorialChecklist.sprintJump ? '✔' : ''}</div>
            <span>{device === 'pc' ? 'Shift 奔跑 + Space 跳躍' : '搖桿推頂端奔跑 + JUMP 跳躍'}</span>
          </div>
          <div className={`checklist-item ${tutorialChecklist.fireMode ? 'completed' : ''}`}>
            <div className="checklist-checkbox">{tutorialChecklist.fireMode ? '✔' : ''}</div>
            <span>{device === 'pc' ? 'B 鍵切換單發/連發' : '點擊模式欄或 B 鍵切換單發/連發'}</span>
          </div>
          <div className={`checklist-item ${tutorialChecklist.shoot ? 'completed' : ''}`}>
            <div className="checklist-checkbox">{tutorialChecklist.shoot ? '✔' : ''}</div>
            <span>開火射擊訓練靶</span>
          </div>
          <div className={`checklist-item ${tutorialChecklist.headshot ? 'completed' : ''}`}>
            <div className="checklist-checkbox">{tutorialChecklist.headshot ? '✔' : ''}</div>
            <span>爆頭擊倒訓練靶 (向上瞄準)</span>
          </div>
          <div className={`checklist-item ${tutorialChecklist.grenade ? 'completed' : ''}`}>
            <div className="checklist-checkbox">{tutorialChecklist.grenade ? '✔' : ''}</div>
            <span>{device === 'pc' ? 'G 鍵投擲戰術手榴彈' : 'GND 按鈕投擲戰術手榴彈'}</span>
          </div>
          <div className={`checklist-item ${tutorialChecklist.refill ? 'completed' : ''}`}>
            <div className="checklist-checkbox">{tutorialChecklist.refill ? '✔' : ''}</div>
            <span>{device === 'pc' ? 'E 鍵至中央彈藥箱補給' : '點擊互動提示進行彈藥補給'}</span>
          </div>
        </div>
      )}

      {/* 教學完成結算面板 */}
      {isTutorialComplete && !isLocked && (
        <div className="tutorial-complete-overlay">
          <div className="hud-panel" style={{ maxWidth: '480px' }}>
            <h1 className="hud-title" style={{ color: '#00ff66', fontSize: '2.0rem' }}>TRAINING COMPLETE</h1>
            <p className="hud-subtitle">ALL OBJECTIVES COMPLETED | READY FOR COMBAT</p>
            
            <div style={{ textAlign: 'left', marginBottom: '25px', color: '#88a888', fontSize: '0.85rem', lineHeight: '1.7', borderTop: '1px dashed var(--hud-bg-border)', paddingTop: '15px' }}>
              <div style={{ marginBottom: '6px' }}><span style={{ color: '#00ff66', marginRight: '8px' }}>✔</span>移動與戰術避讓動作已合格</div>
              <div style={{ marginBottom: '6px' }}><span style={{ color: '#00ff66', marginRight: '8px' }}>✔</span>武器單/連發操控已完成訓練</div>
              <div style={{ marginBottom: '6px' }}><span style={{ color: '#00ff66', marginRight: '8px' }}>✔</span>實彈射擊與標靶爆頭判定已確認</div>
              <div style={{ marginBottom: '6px' }}><span style={{ color: '#00ff66', marginRight: '8px' }}>✔</span>戰術手榴彈投擲與物資箱補給已熟練</div>
            </div>

            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
              <button className="tutorial-complete-button" onClick={handleDeployFromTutorial}>
                DEPLOY TO MISSION
              </button>
              <button 
                className="tutorial-complete-button" 
                style={{ background: 'transparent', color: '#00ff66' }}
                onClick={handleReturnToLobby}
              >
                RETURN TO LOBBY
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 右上角戰術擊殺日誌 */}
      {gameState !== 'deploying' && killFeed.length > 0 && (
        <div className="kill-feed">
          {killFeed.map((feed) => (
            <div key={feed.id} className={`kill-feed-item ${feed.type}`}>
              {feed.type === 'headshot' && <span style={{ marginRight: '4px' }}>☠</span>}
              {feed.type === 'grenade' && <span style={{ marginRight: '4px' }}>💣</span>}
              {feed.message}
            </div>
          ))}
        </div>
      )}

      {/* 準星 (僅在遊玩鎖定且腰射狀態下呈現，開鏡瞄準時隱藏以看清瞄準鏡) */}
      {isLocked && gameState === 'active' && !isAds && (
        <div className="crosshair">
          <div className="crosshair-center" />
        </div>
      )}

      {/* 命中反饋 Hit Marker (擊中時在螢幕中央渲染) */}
      {isLocked && gameState === 'active' && hitMarker.visible && (
        <div className="hit-marker">
          <div className={`hit-marker-line ${hitMarker.isHeadshot ? 'headshot' : ''}`} />
          <div className={`hit-marker-line ${hitMarker.isHeadshot ? 'headshot' : ''}`} />
          <div className={`hit-marker-line ${hitMarker.isHeadshot ? 'headshot' : ''}`} />
          <div className={`hit-marker-line ${hitMarker.isHeadshot ? 'headshot' : ''}`} />
          {hitMarker.isHeadshot && <div className="hit-marker-text">HEADSHOT</div>}
        </div>
      )}

      {/* 物資箱範圍互動提示 */}
      {gameState === 'active' && isLocked && nearStation && (
        <div 
          className={`interaction-prompt ${(nearStation === 'ammo' ? ammoCooldown : medCooldown) > 0 ? 'cooldown' : ''}`}
          onClick={() => {
            if (device === 'mobile') {
              if (nearStation === 'ammo') handleInteractAmmo();
              if (nearStation === 'med') handleInteractMed();
            }
          }}
          style={{
            pointerEvents: device === 'mobile' ? 'auto' : 'none',
            cursor: device === 'mobile' ? 'pointer' : 'default'
          }}
        >
          {nearStation === 'ammo' ? (
            ammoCooldown > 0 ? (
              `STATION RECHARGING (${ammoCooldown}s)`
            ) : (
              device === 'mobile' ? "TAP TO REFILL AMMO & GRENADES" : "PRESS [E] TO REFILL AMMO & GRENADES"
            )
          ) : (
            medCooldown > 0 ? (
              `STATION RECHARGING (${medCooldown}s)`
            ) : (
              device === 'mobile' ? "TAP TO RESTORE HEALTH" : "PRESS [E] TO RESTORE HEALTH"
            )
          )}
        </div>
      )}

      {/* 2.1 選單與結算介面 (滑鼠解鎖時顯示) */}
      {!isLocked && (
        <>
          {gameState === 'deploying' && (
            <div className="menu-overlay">
              {currentUser === null ? (
                // 帳號登入/註冊門檻
                <div className="hud-panel" style={{ maxWidth: '460px', width: '90%' }}>
                  <h1 className="hud-title">DELTA FORCE</h1>
                  <p className="hud-subtitle">3D TACTICAL TRAINING OUTPOST</p>
                  
                  <div className="auth-container">
                    <div className="auth-tabs">
                      <button 
                        type="button"
                        className={`auth-tab ${authTab === 'login' ? 'active' : ''}`}
                        onClick={() => { setAuthTab('login'); setAuthError(''); }}
                      >
                        登入 LOGIN
                      </button>
                      <button 
                        type="button"
                        className={`auth-tab ${authTab === 'register' ? 'active' : ''}`}
                        onClick={() => { setAuthTab('register'); setAuthError(''); }}
                      >
                        註冊 REGISTER
                      </button>
                    </div>

                    {authError && <div className="auth-error">{authError}</div>}

                    {authTab === 'login' ? (
                      <form className="auth-form" onSubmit={handleLogin}>
                        <div className="form-group">
                          <label>使用者帳號 USERNAME</label>
                          <input 
                            type="text" 
                            name="username" 
                            className="auth-input"
                            required
                            placeholder="請輸入帳號"
                            value={authForm.username}
                            onChange={handleAuthInputChange}
                          />
                        </div>
                        <div className="form-group">
                          <label>密碼 PASSWORD</label>
                          <input 
                            type="password" 
                            name="password" 
                            className="auth-input"
                            required
                            placeholder="請輸入密碼"
                            value={authForm.password}
                            onChange={handleAuthInputChange}
                          />
                        </div>
                        <button type="submit" className="auth-submit-btn">驗證登入 AUTHENTICATE</button>
                      </form>
                    ) : (
                      <form className="auth-form" onSubmit={handleRegister}>
                        <div className="form-group">
                          <label>使用者帳號 USERNAME</label>
                          <input 
                            type="text" 
                            name="username" 
                            className="auth-input"
                            required
                            placeholder="英文字母或數字"
                            value={authForm.username}
                            onChange={handleAuthInputChange}
                          />
                        </div>
                        <div className="form-group">
                          <label>玩家暱稱 NICKNAME</label>
                          <input 
                            type="text" 
                            name="nickname" 
                            className="auth-input"
                            required
                            placeholder="遊戲內顯示名稱"
                            value={authForm.nickname}
                            onChange={handleAuthInputChange}
                          />
                        </div>
                        <div className="form-group">
                          <label>密碼 PASSWORD</label>
                          <input 
                            type="password" 
                            name="password" 
                            className="auth-input"
                            required
                            placeholder="密碼密鑰"
                            value={authForm.password}
                            onChange={handleAuthInputChange}
                          />
                        </div>
                        <div className="form-group">
                          <label>確認密碼 CONFIRM PASSWORD</label>
                          <input 
                            type="password" 
                            name="confirmPassword" 
                            className="auth-input"
                            required
                            placeholder="再次輸入密碼"
                            value={authForm.confirmPassword}
                            onChange={handleAuthInputChange}
                          />
                        </div>
                        <button type="submit" className="auth-submit-btn">建立檔案 CREATE PROFILE</button>
                      </form>
                    )}

                    <button 
                      type="button"
                      className="auth-guest-btn"
                      onClick={() => setCurrentUser({ username: 'Guest', nickname: 'GUEST_RECRUIT', isGuest: true })}
                    >
                      以遊客身份遊玩 PLAY AS GUEST
                    </button>
                  </div>
                </div>
              ) : (
                // 登入後的雙欄大廳
                <div className="hud-panel" style={{ maxWidth: '1000px', width: '92%' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '30px' }}>
                    
                    {/* 左欄：設備選擇、部署按鈕與操作指南 */}
                    <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--hud-bg-border)', paddingRight: '30px' }}>
                      <h1 className="hud-title" style={{ textAlign: 'left', fontSize: '2.0rem' }}>DELTA FORCE</h1>
                      <p className="hud-subtitle" style={{ textAlign: 'left', marginBottom: '20px' }}>3D TACTICAL TRAINING OUTPOST</p>
                      
                      {device === null ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '15px' }}>
                          <div style={{ fontSize: '1.0rem', color: '#88a888', letterSpacing: '2px', textAlign: 'left', marginBottom: '5px' }}>
                            SELECT CONTROL INTERFACE:
                          </div>
                          <button className="deploy-button" style={{ fontSize: '1.0rem', padding: '12px' }} onClick={() => setDevice('pc')}>
                            DESKTOP (PC 電腦)
                          </button>
                          <button 
                            className="deploy-button" 
                            style={{ borderColor: '#00e5ff', color: '#00e5ff', boxShadow: '0 0 10px rgba(0, 229, 255, 0.2)', fontSize: '1.0rem', padding: '12px' }}
                            onClick={() => setDevice('mobile')}
                          >
                            MOBILE (行動裝置)
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'left', gap: '15px', marginBottom: '20px' }}>
                            <button className="deploy-button" style={{ fontSize: '1.0rem', padding: '12px 30px' }} onClick={handleDeploy}>
                              DEPLOY TO MISSION
                            </button>
                            <button 
                              className="deploy-button" 
                              style={{ borderColor: '#00e5ff', color: '#00e5ff', boxShadow: '0 0 10px rgba(0, 229, 255, 0.2)', fontSize: '1.0rem', padding: '12px 30px' }}
                              onClick={handleStartTutorial}
                            >
                              START TRAINING
                            </button>
                          </div>

                          {device === 'pc' ? (
                            <div className="controls-guide" style={{ fontSize: '0.8rem', marginTop: '0', paddingTop: '10px' }}>
                              <div><span className="key-cap">W</span><span className="key-cap">A</span><span className="key-cap">S</span><span className="key-cap">D</span> 控制前、左、後、右移動</div>
                              <div><span className="key-cap">Shift</span> 按住跑步 | <span className="key-cap">Space</span> 進行跳躍</div>
                              <div><span className="key-cap">滑鼠左鍵</span> 進行射擊 | <span className="key-cap">滑鼠右鍵</span> 按住開鏡瞄準 (ADS)</div>
                              <div><span className="key-cap">B</span> 切換單發/連發 | <span className="key-cap">G</span> 拋擲戰術手榴彈 (2.5 秒)</div>
                              <div><span className="key-cap">R</span> 重新裝彈 (1.5 秒) | <span className="key-cap">5</span> 使用醫療包 (2.0 秒)</div>
                            </div>
                          ) : (
                            <div className="controls-guide" style={{ fontSize: '0.8rem', marginTop: '0', paddingTop: '10px' }}>
                              <div>左下角 <span className="key-cap">虛擬搖桿</span> 控制前後左右移動與跑步</div>
                              <div>右側 <span className="key-cap">FIRE</span> 射擊 | <span className="key-cap">ADS</span> 開鏡 | <span className="key-cap">JUMP</span> 跳躍 | <span className="key-cap">CCH</span> 蹲下</div>
                              <div>右側 <span className="key-cap">RLD</span> 裝彈 | <span className="key-cap">SWT</span> 切換武器 | <span className="key-cap">GND</span> 手榴彈 | <span className="key-cap">HEAL</span> 補血</div>
                            </div>
                          )}
                          
                          <button 
                            className="tutorial-complete-button" 
                            style={{ background: 'transparent', border: 'none', color: '#88a888', textShadow: 'none', fontSize: '0.75rem', marginTop: '15px', padding: '5px', alignSelf: 'flex-start' }}
                            onClick={() => setDevice(null)}
                          >
                            ← CHANGE DEVICE
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 右欄：個人檔案與生涯統計 */}
                    <div className="lobby-dashboard">
                      <div className="profile-header">
                        <div className="profile-avatar-circle" style={{ borderColor: currentUser.isGuest ? '#88a888' : getRank(currentUser.stats?.kills || 0).color, color: currentUser.isGuest ? '#88a888' : getRank(currentUser.stats?.kills || 0).color }}>
                          {currentUser.nickname.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="profile-title-area">
                          <div className="profile-name-edit-row">
                            {isEditingNickname ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <input 
                                  type="text" 
                                  className="profile-name-input"
                                  value={newNickname}
                                  onChange={(e) => setNewNickname(e.target.value)}
                                  maxLength={12}
                                />
                                <button type="button" className="edit-btn" style={{ color: '#00ff66' }} onClick={handleSaveNickname}>✔</button>
                                <button type="button" className="edit-btn" style={{ color: '#ff3b3b' }} onClick={() => { setIsEditingNickname(false); setNewNickname(currentUser.nickname); }}>✘</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <h2 style={{ margin: 0 }}>{currentUser.nickname}</h2>
                                {!currentUser.isGuest && (
                                  <button type="button" className="edit-btn" onClick={() => setIsEditingNickname(true)}>✏</button>
                                )}
                              </div>
                            )}
                          </div>
                          
                          {!currentUser.isGuest ? (
                            <div className="profile-rank-info" style={{ color: getRank(currentUser.stats.kills).color, display: 'flex', gap: '15px', alignItems: 'center' }}>
                              <span>軍階：{getRank(currentUser.stats.kills).zhTitle} ({getRank(currentUser.stats.kills).title})</span>
                              <span style={{ color: '#ffcc00', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                🪙 {currentUser.coins !== undefined ? currentUser.coins : 0} Delta 幣
                              </span>
                            </div>
                          ) : (
                            <div className="profile-rank-info" style={{ color: '#ffaa00', display: 'flex', gap: '15px', alignItems: 'center' }}>
                              <span>遊客模式 (戰績不予儲存)</span>
                              <span style={{ color: '#ffcc00', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                🪙 {currentUser.coins !== undefined ? currentUser.coins : 0} Delta 幣
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 大廳子分頁分頁切換 */}
                      <div className="lobby-tabs" style={{ display: 'flex', gap: '10px', margin: '15px 0 10px 0', borderBottom: '1px solid var(--hud-bg-border)', paddingBottom: '10px' }}>
                        <button
                          type="button"
                          className={`lobby-tab-btn ${lobbyTab === 'stats' ? 'active' : ''}`}
                          style={{
                            background: lobbyTab === 'stats' ? 'rgba(0, 255, 102, 0.15)' : 'transparent',
                            color: lobbyTab === 'stats' ? '#00ff66' : '#88a888',
                            border: '1px solid',
                            borderColor: lobbyTab === 'stats' ? '#00ff66' : 'rgba(136, 168, 136, 0.3)',
                            padding: '6px 15px',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            borderRadius: '4px',
                            textShadow: lobbyTab === 'stats' ? '0 0 5px rgba(0,255,102,0.5)' : 'none',
                            transition: 'all 0.2s',
                            fontWeight: 'bold'
                          }}
                          onClick={() => setLobbyTab('stats')}
                        >
                          📊 個人數據 STATS
                        </button>
                        <button
                          type="button"
                          className={`lobby-tab-btn ${lobbyTab === 'shop' ? 'active' : ''}`}
                          style={{
                            background: lobbyTab === 'shop' ? 'rgba(255, 204, 0, 0.15)' : 'transparent',
                            color: lobbyTab === 'shop' ? '#ffcc00' : '#88a888',
                            border: '1px solid',
                            borderColor: lobbyTab === 'shop' ? '#ffcc00' : 'rgba(136, 168, 136, 0.3)',
                            padding: '6px 15px',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            borderRadius: '4px',
                            textShadow: lobbyTab === 'shop' ? '0 0 5px rgba(255,204,0,0.5)' : 'none',
                            transition: 'all 0.2s',
                            fontWeight: 'bold'
                          }}
                          onClick={() => setLobbyTab('shop')}
                        >
                          🛒 戰術軍火庫 SHOP
                        </button>
                      </div>

                      {/* 升級進度條 (僅在數據頁顯示) */}
                      {lobbyTab === 'stats' && !currentUser.isGuest && currentUser.stats && (
                        <div className="rank-progress-container">
                          <div className="rank-progress-labels">
                            <span>生涯擊殺：{currentUser.stats.kills}</span>
                            <span>下級軍階：{getRank(currentUser.stats.kills).nextRankTitle} ({getRank(currentUser.stats.kills).nextRankKills ? `${getRank(currentUser.stats.kills).nextRankKills} 殺` : '已滿級'})</span>
                          </div>
                          <div className="rank-progress-bar-bg">
                            <div 
                              className="rank-progress-bar-fill" 
                              style={{ 
                                width: `${getRank(currentUser.stats.kills).progress * 100}%`,
                                backgroundColor: getRank(currentUser.stats.kills).color 
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* 分頁內容 */}
                      {lobbyTab === 'stats' ? (
                        currentUser.isGuest ? (
                          <div className="guest-notice" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffaa00', border: '1px dashed rgba(255, 170, 0, 0.2)', padding: '20px', borderRadius: '4px' }}>
                            <div>
                              ⚠️ <strong>您目前以遊客身份登入</strong><br/>
                              遊客帳號僅能進行實戰演練與新手教學。您的擊殺數、勝率、射擊精準度以及時間將不會計入本機資料庫與排行榜中。<br/>
                              如需記錄戰績，請登出並註冊一個永久軍籍帳號。
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* 生涯數據網格 */}
                            <div className="stats-grid">
                              <div className="stat-item">
                                <div className="stat-item-label">場次 GAMES</div>
                                <div className="stat-item-val">{currentUser.stats.gamesPlayed}</div>
                              </div>
                              <div className="stat-item">
                                <div className="stat-item-label">勝率 WIN RATE</div>
                                <div className="stat-item-val">
                                  {currentUser.stats.gamesPlayed > 0 
                                    ? `${Math.round((currentUser.stats.wins / currentUser.stats.gamesPlayed) * 100)}%` 
                                    : '0%'}
                                </div>
                              </div>
                              <div className="stat-item">
                                <div className="stat-item-label">命中率 ACC</div>
                                <div className="stat-item-val">
                                  {currentUser.stats.shotsFired > 0 
                                    ? `${Math.round((currentUser.stats.shotsHit / currentUser.stats.shotsFired) * 100)}%` 
                                    : '0%'}
                                </div>
                              </div>
                              <div className="stat-item">
                                <div className="stat-item-label">總擊殺 KILLS</div>
                                <div className="stat-item-val">{currentUser.stats.kills}</div>
                              </div>
                              <div className="stat-item">
                                <div className="stat-item-label">爆頭率 HS %</div>
                                <div className="stat-item-val">
                                  {currentUser.stats.kills > 0 
                                    ? `${Math.round((currentUser.stats.headshots / currentUser.stats.kills) * 100)}%` 
                                    : '0%'}
                                </div>
                              </div>
                              <div className="stat-item">
                                <div className="stat-item-label">遊玩時間 TIME</div>
                                <div className="stat-item-val">
                                  {currentUser.stats.playTimeSeconds >= 60 
                                    ? `${Math.floor(currentUser.stats.playTimeSeconds / 60)}m${currentUser.stats.playTimeSeconds % 60}s`
                                    : `${currentUser.stats.playTimeSeconds}s`}
                                </div>
                              </div>
                            </div>

                            {/* 成就系統 */}
                            <div className="achievements-section">
                              <h4>榮譽徽章 BADGES</h4>
                              <div className="badges-grid">
                                <div className={`badge-card ${currentUser.achievements.firstBlood ? 'unlocked' : ''}`}>
                                  <div className="badge-icon">🩸</div>
                                  <div className="badge-name">First Blood</div>
                                  <div className="badge-desc-tooltip">獲得生涯首次擊殺。</div>
                                </div>
                                <div className={`badge-card ${currentUser.achievements.deadeye ? 'unlocked' : ''}`}>
                                  <div className="badge-icon">🎯</div>
                                  <div className="badge-name">Deadeye</div>
                                  <div className="badge-desc-tooltip">累計達成 5 次爆頭擊殺。</div>
                                </div>
                                <div className={`badge-card ${currentUser.achievements.survivor ? 'unlocked' : ''}`}>
                                  <div className="badge-icon">🛡</div>
                                  <div className="badge-name">Survivor</div>
                                  <div className="badge-desc-tooltip">成功生存並贏得一場戰役。</div>
                                </div>
                                <div className={`badge-card ${currentUser.achievements.heavyGunner ? 'unlocked' : ''}`}>
                                  <div className="badge-icon">⚙</div>
                                  <div className="badge-name">Gunner</div>
                                  <div className="badge-desc-tooltip">生涯累計擊發 500 發子彈。</div>
                                </div>
                              </div>
                            </div>

                            {/* 本機排行榜 */}
                            <div className="leaderboard-section">
                              <h4>本機特種排行榜 LEADERBOARD</h4>
                              <div className="leaderboard-wrapper">
                                <table className="leaderboard-table">
                                  <thead>
                                    <tr>
                                      <th>排名</th>
                                      <th>特種隊員</th>
                                      <th>軍銜</th>
                                      <th>總擊殺</th>
                                      <th>勝場</th>
                                      <th>生涯積分</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {leaderboard.map((player, index) => (
                                      <tr key={player.username} className={player.username === currentUser.username ? 'current-user' : ''}>
                                        <td className="leaderboard-rank">#{index + 1}</td>
                                        <td>{player.nickname}</td>
                                        <td>{getRank(player.kills).zhTitle}</td>
                                        <td>{player.kills}</td>
                                        <td>{player.wins}</td>
                                        <td>{player.totalScore}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </>
                        )
                      ) : (
                        /* 戰術商店分頁 */
                        <div className="shop-section" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                          <h4 style={{ margin: '0 0 5px 0', color: '#ffcc00', textShadow: '0 0 5px rgba(255,204,0,0.4)', letterSpacing: '1px' }}>戰術軍火庫 TACTICAL ARMORY</h4>
                          <div className="shop-items-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto', paddingRight: '5px' }}>
                            {SHOP_ITEMS.map((item) => {
                              const isOwned = currentUser.inventory && currentUser.inventory[item.id];
                              return (
                                <div 
                                  key={item.id} 
                                  className={`shop-item-card ${isOwned ? 'owned' : ''}`}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    background: isOwned ? 'rgba(0, 255, 102, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                                    border: '1px solid',
                                    borderColor: isOwned ? 'rgba(0, 255, 102, 0.2)' : 'rgba(136, 168, 136, 0.15)',
                                    borderRadius: '6px',
                                    padding: '12px 15px',
                                    transition: 'all 0.2s'
                                  }}
                                >
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, marginRight: '15px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <span style={{ fontWeight: 'bold', color: isOwned ? '#00ff66' : '#fff', fontSize: '0.9rem' }}>{item.name}</span>
                                      <span style={{ fontSize: '0.7rem', color: '#88a888', letterSpacing: '1px' }}>{item.englishName}</span>
                                    </div>
                                    <span style={{ fontSize: '0.75rem', color: '#a0b0a0', lineHeight: '1.4' }}>{item.description}</span>
                                  </div>
                                  <div>
                                    {isOwned ? (
                                      <button 
                                        type="button" 
                                        disabled
                                        style={{
                                          background: 'rgba(0, 255, 102, 0.1)',
                                          border: '1px solid #00ff66',
                                          color: '#00ff66',
                                          fontSize: '0.75rem',
                                          padding: '6px 12px',
                                          borderRadius: '4px',
                                          cursor: 'default',
                                          textShadow: '0 0 3px rgba(0,255,102,0.3)'
                                        }}
                                      >
                                        已裝備 EQUIPPED
                                      </button>
                                    ) : (
                                      <button 
                                        type="button" 
                                        onClick={() => handleBuyItem(item.id)}
                                        style={{
                                          background: 'rgba(255, 204, 0, 0.1)',
                                          border: '1px solid #ffcc00',
                                          color: '#ffcc00',
                                          fontSize: '0.75rem',
                                          padding: '6px 12px',
                                          borderRadius: '4px',
                                          cursor: 'pointer',
                                          transition: 'all 0.2s',
                                          textShadow: '0 0 3px rgba(255,204,0,0.3)'
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.background = 'rgba(255, 204, 0, 0.2)';
                                          e.currentTarget.style.boxShadow = '0 0 8px rgba(255,204,0,0.3)';
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.background = 'rgba(255, 204, 0, 0.1)';
                                          e.currentTarget.style.boxShadow = 'none';
                                        }}
                                      >
                                        購買 {item.cost} 🪙
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 登出按鈕 */}
                      <div className="dashboard-actions">
                        <button type="button" className="logout-btn" onClick={handleLogout}>登出帳號 LOGOUT</button>
                        {!currentUser.isGuest && currentUser.stats && (
                          <span style={{ fontSize: '0.7rem', color: '#88a888' }}>最高得分：{currentUser.stats.highScore}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {gameState === 'active' && (
            <div className="menu-overlay">
              <div className="hud-panel">
                <h1 className="hud-title" style={{ letterSpacing: '4px' }}>TACTICAL PAUSE</h1>
                <p className="hud-subtitle">TRAINING IN PROGRESS</p>
                <button className="deploy-button" onClick={handleDeploy}>
                  RESUME DEPLOYMENT
                </button>
              </div>
            </div>
          )}

          {gameState === 'victory' && (
            <div className="menu-overlay victory">
              <div className="hud-panel" style={{ maxWidth: '480px' }}>
                <h1 className="hud-title" style={{ color: '#00ff66' }}>MISSION ACCOMPLISHED</h1>
                <p className="hud-subtitle">ALL HOSTILES ELIMINATED | SECURED</p>

                <div className="endgame-stats-panel">
                  <div className="endgame-stats-title">戰術數據結算 TACTICAL ANALYSIS</div>
                  <div className="endgame-stats-row">
                    <span>任務結果 Result</span>
                    <span style={{ color: '#00ff66' }}>任務完成 SUCCESS</span>
                  </div>
                  <div className="endgame-stats-row">
                    <span>擊殺敵軍 Kills</span>
                    <span>{eliminated} / 12</span>
                  </div>
                  <div className="endgame-stats-row">
                    <span>爆頭次數 Headshots</span>
                    <span style={{ color: '#ff1111' }}>{endgameStats ? endgameStats.headshots : 0}</span>
                  </div>
                  <div className="endgame-stats-row">
                    <span>擊發彈藥 Shots Fired</span>
                    <span>{endgameStats ? endgameStats.shotsFired : 0}</span>
                  </div>
                  <div className="endgame-stats-row">
                    <span>射擊精準度 Accuracy</span>
                    <span>
                      {endgameStats && endgameStats.shotsFired > 0 
                        ? `${Math.round((endgameStats.shotsHit / endgameStats.shotsFired) * 100)}%` 
                        : '0%'}
                    </span>
                  </div>
                  <div className="endgame-stats-row">
                    <span>作戰耗時 Duration</span>
                    <span>{endgameStats ? endgameStats.playTimeSeconds : 0} 秒</span>
                  </div>
                </div>

                {endgameStats && endgameStats.coinsEarnedDetails && (
                  <div className="endgame-stats-panel" style={{ marginTop: '15px', borderColor: 'rgba(255, 204, 0, 0.3)' }}>
                    <div className="endgame-stats-title" style={{ color: '#ffcc00', borderColor: 'rgba(255, 204, 0, 0.4)' }}>
                      🪙 金幣獲得獎勵 DELTA COINS EARNED
                    </div>
                    <div className="endgame-stats-row">
                      <span>敵軍擊殺 Kills Bonus</span>
                      <span>+{endgameStats.coinsEarnedDetails.killsCoins}</span>
                    </div>
                    {endgameStats.coinsEarnedDetails.victoryCoins > 0 && (
                      <div className="endgame-stats-row">
                        <span>任務成功 Win Bonus</span>
                        <span>+{endgameStats.coinsEarnedDetails.victoryCoins}</span>
                      </div>
                    )}
                    {endgameStats.coinsEarnedDetails.headshotsCoins > 0 && (
                      <div className="endgame-stats-row">
                        <span>爆頭獎勵 Headshot Bonus</span>
                        <span>+{endgameStats.coinsEarnedDetails.headshotsCoins}</span>
                      </div>
                    )}
                    <div className="endgame-stats-row">
                      <span>精準度加成 Accuracy Bonus</span>
                      <span>+{endgameStats.coinsEarnedDetails.accuracyCoins}</span>
                    </div>
                    <div className="endgame-stats-row" style={{ borderTop: '1px dashed rgba(255,204,0,0.3)', paddingTop: '8px', marginTop: '5px', fontWeight: 'bold' }}>
                      <span style={{ color: '#ffcc00' }}>獲得總額 Total Coins</span>
                      <span style={{ color: '#ffcc00' }}>+{endgameStats.coinsEarnedDetails.total} 🪙</span>
                    </div>
                  </div>
                )}

                <button className="deploy-button" onClick={handleRestart} style={{ marginTop: '15px' }}>
                  RE-DEPLOY {device === 'pc' ? '(R)' : ''}
                </button>
              </div>
            </div>
          )}

          {gameState === 'failed' && (
            <div className="menu-overlay failed">
              <div className="hud-panel" style={{ maxWidth: '480px' }}>
                <h1 className="hud-title" style={{ color: '#ffaa00' }}>MISSION FAILED</h1>
                <p className="hud-subtitle">KIA - KILLED IN ACTION</p>

                <div className="endgame-stats-panel">
                  <div className="endgame-stats-title" style={{ color: '#ffaa00', borderColor: 'var(--hud-amber-glow)' }}>戰術數據結算 TACTICAL ANALYSIS</div>
                  <div className="endgame-stats-row">
                    <span>任務結果 Result</span>
                    <span style={{ color: '#ffaa00' }}>作戰陣亡 K.I.A</span>
                  </div>
                  <div className="endgame-stats-row">
                    <span>擊殺敵軍 Kills</span>
                    <span>{eliminated} / 12</span>
                  </div>
                  <div className="endgame-stats-row">
                    <span>爆頭次數 Headshots</span>
                    <span style={{ color: '#ffaa00' }}>{endgameStats ? endgameStats.headshots : 0}</span>
                  </div>
                  <div className="endgame-stats-row">
                    <span>擊發彈藥 Shots Fired</span>
                    <span>{endgameStats ? endgameStats.shotsFired : 0}</span>
                  </div>
                  <div className="endgame-stats-row">
                    <span>射擊精準度 Accuracy</span>
                    <span>
                      {endgameStats && endgameStats.shotsFired > 0 
                        ? `${Math.round((endgameStats.shotsHit / endgameStats.shotsFired) * 100)}%` 
                        : '0%'}
                    </span>
                  </div>
                  <div className="endgame-stats-row">
                    <span>作戰耗時 Duration</span>
                    <span>{endgameStats ? endgameStats.playTimeSeconds : 0} 秒</span>
                  </div>
                </div>

                {endgameStats && endgameStats.coinsEarnedDetails && (
                  <div className="endgame-stats-panel" style={{ marginTop: '15px', borderColor: 'rgba(255, 204, 0, 0.3)' }}>
                    <div className="endgame-stats-title" style={{ color: '#ffcc00', borderColor: 'rgba(255, 204, 0, 0.4)' }}>
                      🪙 金幣獲得獎勵 DELTA COINS EARNED
                    </div>
                    <div className="endgame-stats-row">
                      <span>敵軍擊殺 Kills Bonus</span>
                      <span>+{endgameStats.coinsEarnedDetails.killsCoins}</span>
                    </div>
                    {endgameStats.coinsEarnedDetails.victoryCoins > 0 && (
                      <div className="endgame-stats-row">
                        <span>任務成功 Win Bonus</span>
                        <span>+{endgameStats.coinsEarnedDetails.victoryCoins}</span>
                      </div>
                    )}
                    {endgameStats.coinsEarnedDetails.headshotsCoins > 0 && (
                      <div className="endgame-stats-row">
                        <span>爆頭獎勵 Headshot Bonus</span>
                        <span>+{endgameStats.coinsEarnedDetails.headshotsCoins}</span>
                      </div>
                    )}
                    <div className="endgame-stats-row">
                      <span>精準度加成 Accuracy Bonus</span>
                      <span>+{endgameStats.coinsEarnedDetails.accuracyCoins}</span>
                    </div>
                    <div className="endgame-stats-row" style={{ borderTop: '1px dashed rgba(255,204,0,0.3)', paddingTop: '8px', marginTop: '5px', fontWeight: 'bold' }}>
                      <span style={{ color: '#ffcc00' }}>獲得總額 Total Coins</span>
                      <span style={{ color: '#ffcc00' }}>+{endgameStats.coinsEarnedDetails.total} 🪙</span>
                    </div>
                  </div>
                )}

                <button className="deploy-button" onClick={handleRestart} style={{ marginTop: '15px' }}>
                  RE-DEPLOY {device === 'pc' ? '(R)' : ''}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 行動端虛擬搖桿與動作按鈕 overlays (僅在遊戲開始且為行動裝置時呈現) */}
      {device === 'mobile' && gameState !== 'deploying' && isLocked && (
        <div className="mobile-controls">
          {/* 搖桿 Joystick */}
          <div 
            className="joystick-container"
            onTouchStart={handleJoystickStart}
            onTouchMove={handleJoystickMove}
            onTouchEnd={handleJoystickEnd}
          >
            <div className="joystick-base">
              <div 
                className="joystick-handle" 
                style={{
                  transform: `translate(${joystickPos.x}px, ${joystickPos.y}px)`
                }}
              />
            </div>
          </div>

          {/* 動作按鈕 Action Buttons */}
          <div className="mobile-buttons-container">
            {/* 開火 */}
            <div 
              className="mobile-btn btn-fire"
              onTouchStart={() => setMobileFiring(true)}
              onTouchEnd={() => setMobileFiring(false)}
            >
              FIRE
            </div>
            
            {/* 跳躍 */}
            <div 
              className="mobile-btn btn-jump"
              onTouchStart={() => { mobileKeysRef.current.jump = true }}
              onTouchEnd={() => { mobileKeysRef.current.jump = false }}
            >
              JUMP
            </div>
            
            {/* 開鏡瞄準 ADS */}
            <div 
              className={`mobile-btn btn-ads ${isAds ? 'active' : ''}`}
              onClick={() => setIsAds((prev) => !prev)}
            >
              ADS
            </div>

            {/* 蹲下 */}
            <div 
              className={`mobile-btn btn-crouch ${mobileCrouch ? 'active' : ''}`}
              onClick={() => {
                setMobileCrouch((prev) => {
                  const next = !prev;
                  mobileKeysRef.current.crouch = next;
                  return next;
                });
              }}
            >
              CCH
            </div>

            {/* 換彈 */}
            <div className="mobile-btn btn-reload" onClick={triggerReload}>
              RLD
            </div>

            {/* 切槍 */}
            <div className="mobile-btn btn-switch" onClick={triggerWeaponSwitch}>
              SWT
            </div>

            {/* 手榴彈 */}
            <div className="mobile-btn btn-grenade" onClick={() => setMobileGrenadeTrigger((prev) => prev + 1)}>
              GND
            </div>

            {/* 補血 */}
            <div className="mobile-btn btn-heal" onClick={triggerHeal}>
              HEAL
            </div>
          </div>

          {/* 暫停 */}
          <button 
            className="mobile-pause-btn"
            onClick={() => setIsLocked(false)}
          >
            PAUSE
          </button>
        </div>
      )}

      {/* 2.2 遊戲 HUD 狀態疊加層 (僅在遊戲開始後顯示) */}
      {gameState !== 'deploying' && (
        <div className="game-hud">
          <div className="hud-top">
            <div className="hud-radar-scanner" />
            <div className="hud-compass">N 024°</div>
            <div className="hud-mission-info">
              <h3>TRAINING OP</h3>
              <div>HOSTILES ELIMINATED: <span style={{ color: '#00ff66', fontWeight: 'bold' }}>{eliminated} / 12</span></div>
            </div>
          </div>

          <div className="hud-bottom">
            <div className="hud-status-card">
              <div className="hud-label">HP VALUE</div>
              <div className="hud-value-bar-container">
                <div className="hud-value-bar" style={{ width: `${health}%`, backgroundColor: health <= 30 ? '#ffaa00' : '#00ff66' }} />
              </div>
              <div className="hud-status-row">
                <span className="hud-large-num" style={{ color: health <= 30 ? '#ffaa00' : 'inherit' }}>{health}</span>
                <span className="hud-small-label">/ 100</span>
              </div>
            </div>

            <div className="hud-status-card">
              <div className="hud-label">AMMUNITION</div>
              <div className="hud-status-row">
                {isReloading ? (
                  <span className="hud-large-num" style={{ color: '#ffaa00', fontSize: '1.25rem', height: '2.7rem', display: 'flex', alignItems: 'center' }}>
                    RELOADING...
                  </span>
                ) : (
                  <>
                    <span className="hud-large-num" style={{ color: ammo <= (activeWeapon === 'primary' ? 5 : 3) ? '#ffaa00' : 'inherit' }}>
                      {ammo}
                    </span>
                    <span className="hud-small-label">/ {activeWeapon === 'primary' ? '30' : '15'} {device === 'pc' ? '(R)' : ''}</span>
                  </>
                )}
              </div>
              <div className="hud-sys-status" style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span>WEAPON: <span className="sys-active" style={{ color: '#00ff66', fontWeight: 'bold' }}>{activeWeapon === 'primary' ? 'M4A1' : 'M9'}</span> <span style={{ color: ammo === 0 ? '#ffaa00' : '#88a888', fontSize: '0.8rem' }}>({ammo === 0 ? 'EMPTY' : 'READY'})</span></span>
                <span 
                  onClick={device === 'mobile' ? triggerFireMode : undefined} 
                  style={{ cursor: device === 'mobile' ? 'pointer' : 'default', userSelect: 'none' }}
                >
                  MODE: <span style={{ color: '#00ff66', fontWeight: 'bold' }}>{fireMode === 'auto' ? 'AUTO' : 'SEMI'}{device === 'pc' ? ' [B]' : ' ⇦'}</span>
                </span>
              </div>
            </div>

            <div className="hud-status-card">
              <div className="hud-label">TACTICAL EQ</div>
              <div className="hud-status-row">
                <span className="hud-large-num" style={{ color: grenades === 0 ? '#ffaa00' : 'inherit' }}>
                  {grenades}
                </span>
                <span className="hud-small-label">/ 2 {device === 'pc' ? '(G)' : ''}</span>
              </div>
              <div className="hud-sys-status">
                GRENADE: <span className="sys-active" style={{ color: grenades === 0 ? '#ffaa00' : '#00ff66' }}>{grenades === 0 ? 'DEPLETED' : 'READY'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3D Canvas 容器 */}
      <div className="canvas-container">
        <Canvas shadows camera={{ fov: 70, near: 0.1, far: 200 }}>
          <ambientLight intensity={0.5} />
          <directionalLight
            castShadow
            position={[50, 80, 50]}
            intensity={1.5}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-near={0.5}
            shadow-camera-far={180}
            shadow-camera-left={-70}
            shadow-camera-right={70}
            shadow-camera-top={70}
            shadow-camera-bottom={-70}
          />
          <Sky sunPosition={[50, 80, 50]} distance={450000} />

          {/* 地面與環境防禦工事 */}
          <Ground />
          <PerimeterWalls />
          <TacticalAssets />

          {/* 3D 戰術補給站 */}
          <AmmoSupplyStation position={[0, 0, -0.8]} active={ammoCooldown === 0} />
          <MedicalSupplyStation position={[3.0, 0, 92.0]} active={medCooldown === 0} />

          {/* 渲染彈孔貼紙 */}
          {holes.map((hole) => (
            <BulletHole key={hole.id} position={hole.position} normal={hole.normal} />
          ))}

          {/* 渲染噴沙塵粒子 */}
          {particles.map((p) => (
            <DustParticle key={p.id} position={p.position} velocity={p.velocity} color={p.color} />
          ))}

          {/* 渲染物理拋殼 */}
          {casings.map((c) => (
            <ShellCasing key={c.id} position={c.position} velocity={c.velocity} />
          ))}

          {/* 渲染物理掉落彈匣 */}
          {droppedMags.map((m) => (
            <DroppedMagazine key={m.id} position={m.position} velocity={m.velocity} />
          ))}

          {/* 渲染拋擲手榴彈 */}
          {grenadeEntities.map((g) => (
            <Grenade
              key={g.id}
              position={g.position}
              velocity={g.velocity}
              onExplode={(point) => handleExplodeGrenade(g.id, point)}
            />
          ))}

          {/* 敵軍 AI 或訓練標靶 */}
          {enemies.map((enemy) => (
            enemy.isDummy ? (
              <TrainingDummy
                key={enemy.id}
                data={enemy}
                onKilled={handleEnemyKilled}
              />
            ) : (
              <Enemy
                key={enemy.id}
                data={enemy}
                onShootPlayer={handleShootPlayer}
                onKilled={handleEnemyKilled}
              />
            )
          ))}

          {/* 突擊步槍與手槍模型 */}
          <Weapon gunRef={gunRef} muzzleFlashRef={muzzleFlashRef} isAds={isAds} isLocked={isLocked} activeWeapon={activeWeapon} isHealing={isHealing} />

          {/* 玩家與開火 Raycaster 控制器 */}
          <PlayerController
            weaponRef={gunRef}
            muzzleFlashRef={muzzleFlashRef}
            ammo={ammo}
            setAmmo={setAmmo}
            isReloading={isReloading}
            isHealing={isHealing}
            gameState={gameState}
            onHitEnemy={handleHitEnemy}
            addImpactEffect={addImpactEffect}
            resetTrigger={resetTrigger}
            isAds={isAds}
            setIsAds={setIsAds}
            fireMode={fireMode}
            grenades={grenades}
            setGrenades={setGrenades}
            addCasing={addCasing}
            addDroppedMag={addDroppedMag}
            addGrenade={addGrenade}
            shakeTrigger={shakeTrigger}
            enemies={enemies}
            setNearStation={setNearStation}
            onInteractAmmo={handleInteractAmmo}
            onInteractMed={handleInteractMed}
            isTutorial={isTutorial}
            onTriggerTutorial={triggerTutorialStep}
            activeWeapon={activeWeapon}
            device={device}
            mobileKeysRef={mobileKeysRef}
            mobileFiring={mobileFiring}
            mobileGrenadeTrigger={mobileGrenadeTrigger}
            runStatsRef={runStatsRef}
          />

          {/* Drei 第一人稱滑鼠鎖定控制器 */}
          {device !== 'mobile' && gameState === 'active' && (
            <PointerLockControls
              ref={controlsRef}
              onLock={() => setIsLocked(true)}
              onUnlock={() => setIsLocked(false)}
            />
          )}
        </Canvas>
      </div>
    </>
  );
}
