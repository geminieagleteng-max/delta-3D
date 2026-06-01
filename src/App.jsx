import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls, Sky, Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import './App.css';
import {
  getRank, getLeaderboard, loginAccount, loginAccountByGameKey, registerAccount, updateNickname, updateStats,
  equipItem, unequipItem, buyMarketItem, sellMarketItem, saveMatchLoot,
  initializeGridStash, moveGridItem, getItemSize, generateUid, findEmptySpace, rotateGridItem,
  getModifiedWeaponConfig, equipAttachmentToWeapon, unequipAttachmentFromWeapon,
  equipAttachmentToEquippedWeapon, unequipAttachmentFromEquippedWeapon, sellMarketItemByUid, claimContractReward,
  sortGridStash, autoSortStashItems, getAccounts, saveAccounts
} from './utils/account';
import { fetchCloudLeaderboard, syncPlayerToCloud } from './utils/cloudLeaderboard';
import { ITEM_NAMES, MARKET_PRICES } from './config/marketConfig';
import { ATTACHMENTS, ATTACHMENT_TYPES } from './config/attachmentsConfig';


// ==========================================
// 00. 槍枝武器規格設定 (Weapon Configurations)
// ==========================================
const WEAPON_CONFIGS = {
  m4a1: { maxAmmo: 30, fireMode: 'auto', fireInterval: 110, damage: 25, recoil: 0.07, isPrimary: true, name: 'M4A1 突擊步槍' },
  ak47: { maxAmmo: 30, fireMode: 'auto', fireInterval: 140, damage: 38, recoil: 0.11, isPrimary: true, name: 'AK-47 突擊步槍' },
  awp: { maxAmmo: 5, fireMode: 'semi', fireInterval: 1500, damage: 100, recoil: 0.25, isPrimary: true, name: 'AWP 狙擊步槍' },
  mp5: { maxAmmo: 30, fireMode: 'auto', fireInterval: 80, damage: 18, recoil: 0.04, isPrimary: true, name: 'MP5 衝鋒槍' },
  m870: { maxAmmo: 6, fireMode: 'semi', fireInterval: 800, damage: 12, recoil: 0.18, isPrimary: true, name: 'M870 散彈槍' },
  m9: { maxAmmo: 15, fireMode: 'semi', fireInterval: 200, damage: 15, recoil: 0.04, isPrimary: false, name: 'M9 戰術手槍' },
  deagle: { maxAmmo: 7, fireMode: 'semi', fireInterval: 350, damage: 45, recoil: 0.12, isPrimary: false, name: '沙鷹重型手槍' }
};

// ==========================================
// 0. 原生自體波形合成音效系統 (Procedural Web Audio API)
// ==========================================
class ProceduralAudio {
  constructor() {
    this.ctx = null;
    this.ambientOsc = null;
    this.ambientGain = null;
    this.ambientLfo = null;
    this.heliOsc = null;
    this.heliLfo = null;
    this.heliNoise = null;
    this.heliGain = null;
  }

  startHelicopterSound() {
    this.resume();
    if (!this.ctx) return;
    if (this.heliOsc) return;

    try {
      const humOsc = this.ctx.createOscillator();
      const humFilter = this.ctx.createBiquadFilter();
      humOsc.type = 'triangle';
      humOsc.frequency.setValueAtTime(50, this.ctx.currentTime);
      humFilter.type = 'lowpass';
      humFilter.frequency.setValueAtTime(120, this.ctx.currentTime);
      
      const bufferSize = this.ctx.sampleRate * 2.0;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.loop = true;
      
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(180, this.ctx.currentTime);
      noiseFilter.Q.setValueAtTime(1.5, this.ctx.currentTime);

      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.type = 'sawtooth';
      lfo.frequency.setValueAtTime(10.5, this.ctx.currentTime);
      lfoGain.gain.setValueAtTime(0.55, this.ctx.currentTime);

      const modGain = this.ctx.createGain();
      modGain.gain.setValueAtTime(0.4, this.ctx.currentTime);

      lfo.connect(lfoGain);
      lfoGain.connect(modGain.gain);

      humOsc.connect(humFilter);
      humFilter.connect(modGain);
      
      noiseSource.connect(noiseFilter);
      noiseFilter.connect(modGain);

      const mainGain = this.ctx.createGain();
      mainGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      mainGain.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + 10.0); // 10s fade in
      
      modGain.connect(mainGain);
      mainGain.connect(this.ctx.destination);

      lfo.start();
      humOsc.start();
      noiseSource.start();

      this.heliOsc = humOsc;
      this.heliLfo = lfo;
      this.heliNoise = noiseSource;
      this.heliGain = mainGain;
    } catch (e) {
      console.warn('Failed to start helicopter sound:', e);
    }
  }

  stopHelicopterSound() {
    if (this.heliOsc) {
      try {
        this.heliOsc.stop();
        this.heliLfo.stop();
        this.heliNoise.stop();
        if (this.heliGain) {
          this.heliGain.disconnect();
        }
      } catch (e) {}
      this.heliOsc = null;
      this.heliLfo = null;
      this.heliNoise = null;
      this.heliGain = null;
    }
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

  playGunshot(isSilenced = false) {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    try {
      // 1. 擊發重低音 (Sine)
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(isSilenced ? 80 : 140, now);
      subOsc.frequency.exponentialRampToValueAtTime(isSilenced ? 40 : 55, now + 0.08);
      subGain.gain.setValueAtTime(isSilenced ? 0.15 : 0.8, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + (isSilenced ? 0.06 : 0.12));
      
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.15);

      // 2. 槍口爆破噪音 (Noise)
      const bufferSize = this.ctx.sampleRate * (isSilenced ? 0.15 : 0.35);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(isSilenced ? 500 : 900, now);
      filter.frequency.exponentialRampToValueAtTime(isSilenced ? 80 : 120, now + (isSilenced ? 0.12 : 0.3));
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(isSilenced ? 0.12 : 0.7, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + (isSilenced ? 0.14 : 0.32));
      
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

  playMeleeSwipe() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(80, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch (e) {}
  }

  playKnifeHit() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.12);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
      this.playClick(now, 400, 0.4, 0.08);
    } catch (e) {}
  }

  playFlashbangExplosion() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      const popOsc = this.ctx.createOscillator();
      const popGain = this.ctx.createGain();
      popOsc.type = 'sine';
      popOsc.frequency.setValueAtTime(300, now);
      popOsc.frequency.exponentialRampToValueAtTime(60, now + 0.12);
      popGain.gain.setValueAtTime(0.8, now);
      popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      popOsc.connect(popGain);
      popGain.connect(this.ctx.destination);
      popOsc.start(now);
      popOsc.stop(now + 0.25);

      const ringOsc = this.ctx.createOscillator();
      const ringGain = this.ctx.createGain();
      ringOsc.type = 'sine';
      ringOsc.frequency.setValueAtTime(6000, now);
      ringGain.gain.setValueAtTime(0.25, now);
      ringGain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);
      ringOsc.connect(ringGain);
      ringGain.connect(this.ctx.destination);
      ringOsc.start(now);
      ringOsc.stop(now + 3.1);
    } catch (e) {}
  }

  playSmokeHiss() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      const bufferSize = this.ctx.sampleRate * 2.0;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1000, now);
      filter.Q.setValueAtTime(1.0, now);
      const gainNode = this.ctx.createGain();
      gainNode.gain.setValueAtTime(0.22, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.95);
      noiseSource.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.ctx.destination);
      noiseSource.start(now);
      noiseSource.stop(now + 2.0);
    } catch (e) {}
  }

  playPistolGunshot(isSilenced = false) {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    try {
      // 1. 擊發重低音 (Sine) - 手槍音調偏高
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(isSilenced ? 120 : 240, now);
      subOsc.frequency.exponentialRampToValueAtTime(isSilenced ? 60 : 90, now + 0.06);
      subGain.gain.setValueAtTime(isSilenced ? 0.12 : 0.5, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + (isSilenced ? 0.05 : 0.1));
      
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.12);

      // 2. 槍口爆破噪音 (Noise) - 手槍較短促清脆
      const bufferSize = this.ctx.sampleRate * (isSilenced ? 0.08 : 0.22);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(isSilenced ? 800 : 1400, now);
      filter.frequency.exponentialRampToValueAtTime(isSilenced ? 180 : 280, now + (isSilenced ? 0.10 : 0.18));
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(isSilenced ? 0.10 : 0.45, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + (isSilenced ? 0.12 : 0.2));
      
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

  playAK47() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      // AK-47 重步槍：低音 Sine 波
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(115, now);
      subOsc.frequency.exponentialRampToValueAtTime(45, now + 0.09);
      subGain.gain.setValueAtTime(0.95, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.16);

      // 爆破噪音 (Noise) - 比 M4A1 稍微低沉
      const bufferSize = this.ctx.sampleRate * 0.38;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(750, now);
      filter.frequency.exponentialRampToValueAtTime(95, now + 0.32);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.8, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      
      noiseNode.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      
      noiseNode.start(now);
      noiseNode.stop(now + 0.38);
    } catch (e) {
      console.warn('AK-47 sound failed:', e);
    }
  }

  playAWP() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      // AWP 重狙擊槍：極重低音 (Sine)
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(85, now);
      subOsc.frequency.exponentialRampToValueAtTime(15, now + 0.22);
      subGain.gain.setValueAtTime(1.4, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.4);

      // AWP 重型爆破震波與尾音環境迴響 (Noise)
      const bufferSize = this.ctx.sampleRate * 1.1;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, now);
      filter.frequency.exponentialRampToValueAtTime(25, now + 0.75);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(1.15, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.05);
      
      noiseNode.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      
      noiseNode.start(now);
      noiseNode.stop(now + 1.1);
    } catch (e) {
      console.warn('AWP sound failed:', e);
    }
  }

  playMP5() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      // MP5 輕微衝鋒槍：音調稍高、擊發快速
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(170, now);
      subOsc.frequency.exponentialRampToValueAtTime(75, now + 0.05);
      subGain.gain.setValueAtTime(0.48, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.1);

      // 高頻清脆的爆破噪音 (Noise)
      const bufferSize = this.ctx.sampleRate * 0.16;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1300, now);
      filter.frequency.exponentialRampToValueAtTime(450, now + 0.12);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.55, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      
      noiseNode.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      
      noiseNode.start(now);
      noiseNode.stop(now + 0.16);
    } catch (e) {
      console.warn('MP5 sound failed:', e);
    }
  }

  playShotgun() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      // M870 散彈槍：多彈丸同步噴射、強烈空氣爆裂感 (Sine)
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(95, now);
      subOsc.frequency.exponentialRampToValueAtTime(25, now + 0.16);
      subGain.gain.setValueAtTime(1.25, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.3);

      // 大範圍爆裂噪音 (Noise)
      const bufferSize = this.ctx.sampleRate * 0.52;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(650, now);
      filter.frequency.exponentialRampToValueAtTime(45, now + 0.42);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(1.05, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      
      noiseNode.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      
      noiseNode.start(now);
      noiseNode.stop(now + 0.52);

      // 擊發後 0.42s 與 0.56s 自動觸發泵動式退彈/上膛聲 (Pump clack-clack)
      this.playClick(now + 0.42, 950, 0.24, 0.05);
      this.playClick(now + 0.55, 750, 0.26, 0.06);
    } catch (e) {
      console.warn('Shotgun sound failed:', e);
    }
  }

  playDeagle() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      // 沙鷹重型手槍：沉重低音 (Sine)
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(160, now);
      subOsc.frequency.exponentialRampToValueAtTime(50, now + 0.08);
      subGain.gain.setValueAtTime(0.85, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.18);

      // 強烈爆破噪音 (Noise) - 手槍類中最大聲
      const bufferSize = this.ctx.sampleRate * 0.3;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1050, now);
      filter.frequency.exponentialRampToValueAtTime(130, now + 0.24);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.85, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      
      noiseNode.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      
      noiseNode.start(now);
      noiseNode.stop(now + 0.3);
    } catch (e) {
      console.warn('Deagle sound failed:', e);
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

// 兵種類型常量
const ENEMY_TYPES = {
  ASSAULT: 'assault',     // 突擊兵
  SHIELD: 'shield',       // 盾兵
  GRENADIER: 'grenadier', // 擲彈兵
  SNIPER: 'sniper',       // 狙擊手
};

// 各兵種基礎數值設定
const ENEMY_STATS = {
  assault: { 
    hp: 100, 
    speed: 3.5, 
    rushSpeed: 4.0, 
    range: 60, 
    damage: 10, 
    cooldown: 2.0, 
    hitRate: 0.35, 
    bodyColor: '#aa2222', 
    helmetColor: '#5c0f0f', 
    hpBarColor: '#ff3333' 
  },
  shield: { 
    hp: 200, 
    speed: 1.2, 
    rushSpeed: 1.2, 
    range: 15, 
    damage: 8, 
    cooldown: 1.5, 
    hitRate: 0.3, 
    bodyColor: '#3a6b35', 
    helmetColor: '#1d3b1a', 
    hpBarColor: '#00cc66' 
  },
  grenadier: { 
    hp: 80, 
    speed: 2.0, 
    rushSpeed: 2.4, 
    range: 50, 
    damage: 35, 
    cooldown: 6.0, 
    hitRate: 0.0,
    bodyColor: '#8b6914', 
    helmetColor: '#4f3b0b', 
    hpBarColor: '#ffa500' 
  },
  sniper: { 
    hp: 80, 
    speed: 0, 
    rushSpeed: 0, 
    range: 160, 
    damage: 20, 
    cooldown: 3.5, 
    hitRate: 1.0, 
    bodyColor: '#253b59', 
    helmetColor: '#132133', 
    hpBarColor: '#0088ff' 
  },
};

// 狙擊哨塔上的固定狙擊手出生點
const SNIPER_POSITIONS = [
  new THREE.Vector3(-95, 4.2, -95),
  new THREE.Vector3(95, 4.2, 95),
  new THREE.Vector3(-95, 4.2, 95),
  new THREE.Vector3(95, 4.2, -95)
];

// 各波次兵種比例配置
const WAVE_COMPOSITIONS = {
  1: [
    { type: ENEMY_TYPES.ASSAULT, count: 3 },
    { type: ENEMY_TYPES.SHIELD, count: 1 },
    { type: ENEMY_TYPES.SNIPER, count: 1 },
  ],
  2: [
    { type: ENEMY_TYPES.ASSAULT, count: 3 },
    { type: ENEMY_TYPES.SHIELD, count: 1 },
    { type: ENEMY_TYPES.GRENADIER, count: 2 },
    { type: ENEMY_TYPES.SNIPER, count: 1 },
  ],
  3: [
    { type: ENEMY_TYPES.ASSAULT, count: 4 },
    { type: ENEMY_TYPES.SHIELD, count: 2 },
    { type: ENEMY_TYPES.GRENADIER, count: 2 },
    { type: ENEMY_TYPES.SNIPER, count: 2 },
  ],
};

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
  { x: -60.9, z: -45, hx: 0.1, hz: 4.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Left Railing
  { x: -69.1, z: -45, hx: 0.1, hz: 4.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Right Railing
  { x: -67.75, z: -49.1, hx: 1.25, hz: 0.1, minY: 3.6, maxY: 5.0 }, // 2nd Floor Front Left Rail
  { x: -62.25, z: -49.1, hx: 1.25, hz: 0.1, minY: 3.6, maxY: 5.0 },  // 2nd Floor Front Right Rail

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

export const FACILITY_COLLIDERS = [
  // 1. Vending Machines (Rotated 90 deg, hx/hz swapped)
  { x: -3.4, z: -60, hx: 0.45, hz: 0.65 },
  { x: 3.4, z: -25, hx: 0.45, hz: 0.65 },
  { x: -3.4, z: 30, hx: 0.45, hz: 0.65 },
  { x: 3.4, z: 70, hx: 0.45, hz: 0.65 },

  // 2. Trash Cans
  { x: -3.4, z: -58, hx: 0.35, hz: 0.35 },
  { x: 3.4, z: -27, hx: 0.35, hz: 0.35 },
  { x: -3.4, z: 32, hx: 0.35, hz: 0.35 },
  { x: 3.4, z: 68, hx: 0.35, hz: 0.35 },

  // 3. Cover Crates
  { x: -1.8, z: -40, hx: 0.75, hz: 0.75 },
  { x: 1.5, z: -10, hx: 0.75, hz: 0.75 },
  { x: -1.2, z: 15, hx: 0.75, hz: 0.75 },
  { x: 1.6, z: 45, hx: 0.75, hz: 0.75 },
  { x: 0, z: -85, hx: 0.75, hz: 0.75 }
];

export const LOOT_CONTAINERS = [
  { id: 1, name: '軍用武器箱', position: new THREE.Vector3(-25, 0.4, 15), type: 'weapon' },
  { id: 2, name: '醫療補給箱', position: new THREE.Vector3(30, 0.4, -20), type: 'med' },
  { id: 3, name: '機密保險箱', position: new THREE.Vector3(-45, 0.4, -35), type: 'safe' },
  { id: 4, name: '戰術物資箱', position: new THREE.Vector3(20, 0.4, 50), type: 'default' },
  { id: 5, name: '加密電腦主機', position: new THREE.Vector3(-15, 0.4, -15), type: 'pc' },
  { id: 6, name: '實驗室密室保險箱', position: new THREE.Vector3(-75, 0.4, 0), type: 'locked_safe', requiresKeycard: 'keycard' }
];

export const spawnWave = (waveNumber, difficultyMultiplier = 1.0, isAmbush = false, mapType = 'outpost', facilityEvent = 'normal') => {
  const composition = WAVE_COMPOSITIONS[waveNumber] || WAVE_COMPOSITIONS[3];
  const spawned = [];
  let idCounter = 0;
  let sniperIndex = 0;

  for (const group of composition) {
    for (let i = 0; i < group.count; i++) {
      const stats = ENEMY_STATS[group.type];
      let pos;

      if (group.type === ENEMY_TYPES.SNIPER) {
        if (mapType === 'facility') {
          // 在地鐵通道內隨機分布，不能在塔上
          pos = new THREE.Vector3((Math.random() - 0.5) * 4.0, 0, -110 + Math.random() * 40);
        } else {
          pos = SNIPER_POSITIONS[sniperIndex % SNIPER_POSITIONS.length].clone();
          sniperIndex++;
        }
      } else {
        let x, z;
        if (mapType === 'facility') {
          // 地鐵隨機位置
          x = (Math.random() - 0.5) * 6.0;
          z = (Math.random() - 0.5) * 180;
          while (z > 80) { // 避開玩家出生區 (Z=85~110)
            z = (Math.random() - 0.5) * 180;
          }
        } else {
          x = (Math.random() - 0.5) * 180;
          z = (Math.random() - 0.5) * 180;
          while (Math.sqrt(x * x + (z - 95) * (z - 95)) < 40) {
            x = (Math.random() - 0.5) * 180;
            z = (Math.random() - 0.5) * 180;
          }
        }
        pos = new THREE.Vector3(x, 0, z);
      }

      if (mapType === 'facility' && facilityEvent === 'warp') {
        const warpZ = pos.z;
        const x_c = Math.sin(warpZ * 0.04) * 6.0;
        const rotY = Math.atan(0.24 * Math.cos(warpZ * 0.04));
        const newX = x_c + pos.x * Math.cos(rotY);
        const newZ = warpZ - pos.x * Math.sin(rotY);
        pos.set(newX, pos.y, newZ);
      }

      // 伏擊事件會使精銳敵人的生命值加倍
      const hpMultiplier = isAmbush ? 2.0 : 1.0;
      const finalHp = Math.round(stats.hp * difficultyMultiplier * hpMultiplier);

      spawned.push({
        id: waveNumber * 100 + idCounter + 1,
        position: pos,
        hp: finalHp,
        maxHp: finalHp,
        enemyType: group.type,
        state: 'alive',
        patrolCenter: pos.clone(),
        isElite: isAmbush // 標記為精銳
      });
      idCounter++;
    }
  }
  return spawned;
};

const spawnEnemies = (isTutorial = false, difficultyMultiplier = 1.0, isAmbush = false, mapType = 'outpost') => {
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
        position: new THREE.Vector3(mapType === 'facility' ? -2 : -6, 0, 60), // 前移至距玩家 35 米處，稍微靠左
        hp: 100,
        state: 'alive',
        isDummy: true,
      }
    ];
  }
  return spawnWave(1, difficultyMultiplier, isAmbush, mapType);
};

export function LootCrate({ position, name, isLooted, type = 'default', rotation = [0, 0, 0] }) {
  if (type === 'pc') {
    return (
      <group position={position} rotation={rotation}>
        {/* PC 主機箱體 */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.4, 0.7, 0.7]} />
          <meshStandardMaterial color={isLooted ? '#2a2a2a' : '#121212'} roughness={0.3} metalness={0.8} />
        </mesh>
        {/* 前面板設計 */}
        <mesh position={[0, 0, 0.36]} castShadow>
          <boxGeometry args={[0.36, 0.66, 0.03]} />
          <meshStandardMaterial color="#1e1e1e" roughness={0.8} />
        </mesh>
        {/* 電源指示燈 */}
        <mesh position={[0.12, 0.28, 0.38]}>
          <sphereGeometry args={[0.015, 6, 6]} />
          <meshBasicMaterial color={isLooted ? '#555' : '#00ff66'} />
        </mesh>
      </group>
    );
  }

  if (type === 'safe' || type === 'locked_safe') {
    const isLockedType = type === 'locked_safe';
    return (
      <group position={position} rotation={rotation}>
        {/* 重型保險箱體 */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.8, 0.8, 0.8]} />
          <meshStandardMaterial color={isLooted ? '#3b3d40' : '#4a5056'} roughness={0.4} metalness={0.7} />
        </mesh>
        {/* 門縫線 */}
        <mesh position={[0, 0, 0.405]}>
          <boxGeometry args={[0.72, 0.72, 0.01]} />
          <meshStandardMaterial color="#151718" roughness={0.9} />
        </mesh>
        {/* 旋轉密碼鎖 */}
        <mesh position={[-0.15, 0.05, 0.415]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 0.03, 16]} />
          <meshStandardMaterial color="#2b2d2f" metalness={0.9} roughness={0.2} />
        </mesh>
        {/* 密碼鎖把手 */}
        <mesh position={[-0.15, 0.05, 0.435]} rotation={[0, 0, Math.PI / 4]} castShadow>
          <boxGeometry args={[0.15, 0.03, 0.02]} />
          <meshStandardMaterial color="#666" metalness={0.9} />
        </mesh>
        {/* 鑰匙卡感應器 / 狀態指示燈 */}
        <mesh position={[0.18, 0.2, 0.415]} castShadow>
          <boxGeometry args={[0.18, 0.12, 0.02]} />
          <meshStandardMaterial color="#1f2122" roughness={0.6} />
        </mesh>
        {/* 感應器 LED */}
        <mesh position={[0.18, 0.2, 0.428]}>
          <sphereGeometry args={[0.02, 8, 8]} />
          <meshBasicMaterial color={isLooted ? '#444' : isLockedType ? '#ff1100' : '#00ff66'} />
        </mesh>
        {isLockedType && !isLooted && (
          <pointLight position={[0.18, 0.2, 0.5]} color="#ff1100" intensity={1.5} distance={3} />
        )}
      </group>
    );
  }

  if (type === 'weapon') {
    const boxColor = isLooted ? '#263028' : '#35483a';
    return (
      <group position={position} rotation={rotation}>
        {/* 長型武器箱體 */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.6, 0.45, 0.7]} />
          <meshStandardMaterial color={boxColor} roughness={0.8} metalness={0.4} />
        </mesh>
        {/* 強化邊緣筋條 */}
        <mesh position={[0, 0.23, 0]} castShadow>
          <boxGeometry args={[1.64, 0.03, 0.74]} />
          <meshStandardMaterial color={isLooted ? '#1c241e' : '#223026'} roughness={0.9} />
        </mesh>
        {/* 箱扣 */}
        <mesh position={[-0.4, 0.1, 0.355]} castShadow>
          <boxGeometry args={[0.08, 0.12, 0.02]} />
          <meshStandardMaterial color="#1a1a1a" metalness={0.9} />
        </mesh>
        <mesh position={[0.4, 0.1, 0.355]} castShadow>
          <boxGeometry args={[0.08, 0.12, 0.02]} />
          <meshStandardMaterial color="#1a1a1a" metalness={0.9} />
        </mesh>
      </group>
    );
  }

  if (type === 'med') {
    const boxColor = isLooted ? '#cfcfcf' : '#f0f3f5';
    return (
      <group position={position} rotation={rotation}>
        {/* 醫療箱體 */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.8, 0.5, 0.5]} />
          <meshStandardMaterial color={boxColor} roughness={0.4} />
        </mesh>
        {/* 醫療十字標誌 - 橫條 */}
        {!isLooted && (
          <group position={[0, 0, 0.252]}>
            <mesh>
              <boxGeometry args={[0.22, 0.06, 0.005]} />
              <meshBasicMaterial color="#ff1111" />
            </mesh>
            {/* 醫療十字標誌 - 直條 */}
            <mesh>
              <boxGeometry args={[0.06, 0.22, 0.005]} />
              <meshBasicMaterial color="#ff1111" />
            </mesh>
          </group>
        )}
      </group>
    );
  }

  // 預設木箱物資箱 (type === 'default')
  const boxColor = isLooted ? '#424542' : '#8c593b';
  return (
    <group position={position} rotation={rotation}>
      {/* 底部箱體 */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.7, 0.8]} />
        <meshStandardMaterial color={boxColor} roughness={0.7} metalness={0.2} />
      </mesh>
      {/* 箱蓋 */}
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[1.36, 0.1, 0.86]} />
        <meshStandardMaterial color={isLooted ? '#2c2e2c' : '#5c3a25'} roughness={0.8} />
      </mesh>
      {/* 扣環鎖具 */}
      <mesh position={[-0.4, 0.32, 0.41]} castShadow>
        <boxGeometry args={[0.08, 0.16, 0.04]} />
        <meshStandardMaterial color="#222" roughness={0.3} metalness={0.9} />
      </mesh>
      <mesh position={[0.4, 0.32, 0.41]} castShadow>
        <boxGeometry args={[0.08, 0.16, 0.04]} />
        <meshStandardMaterial color="#222" roughness={0.3} metalness={0.9} />
      </mesh>
    </group>
  );
}

export function LandingPad({ active }) {
  const [blinkOn, setBlinkOn] = useState(true);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setBlinkOn((prev) => !prev);
    }, 400);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const lights = [];
  const radius = 7.9;
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const x = radius * Math.cos(angle);
    const z = radius * Math.sin(angle);
    lights.push(
      <group key={i} position={[x, 0.05, z]}>
        <mesh>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshBasicMaterial color={blinkOn ? "#00ff66" : "#ff3333"} />
        </mesh>
        <pointLight color={blinkOn ? "#00ff66" : "#ff3333"} intensity={blinkOn ? 1.5 : 0.2} distance={3} />
      </group>
    );
  }

  return (
    <group position={[0, 0.01, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[0, 8.2, 32]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>

      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[7.8, 8.0, 32]} />
        <meshBasicMaterial color="#ffcc00" />
      </mesh>

      <group position={[0, 0.006, 0]}>
        <mesh position={[-1.3, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.6, 3.2]} />
          <meshBasicMaterial color="#ffcc00" doubleSide />
        </mesh>
        <mesh position={[1.3, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.6, 3.2]} />
          <meshBasicMaterial color="#ffcc00" doubleSide />
        </mesh>
        <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.0, 0.6]} />
          <meshBasicMaterial color="#ffcc00" doubleSide />
        </mesh>
      </group>

      {lights}
    </group>
  );
}

export function ExtractionHelicopter({ active, onLanded }) {
  const groupRef = useRef();
  const rotorRef = useRef();
  const tailRotorRef = useRef();
  
  const flightProgress = useRef(0);
  const landedCalled = useRef(false);

  const startPos = new THREE.Vector3(-120, 80, -120);
  const targetPos = new THREE.Vector3(0, 1.35, 0);

  const [spotlightTarget] = useState(() => {
    const obj = new THREE.Object3D();
    obj.position.set(0, 0, 0);
    return obj;
  });

  useEffect(() => {
    if (!active) {
      flightProgress.current = 0;
      landedCalled.current = false;
    }
  }, [active]);

  useFrame((state, delta) => {
    if (!active) return;

    const safeDelta = Math.min(delta, 0.1);

    const rotorSpeed = 22.0;
    if (rotorRef.current) {
      rotorRef.current.rotation.y += rotorSpeed * safeDelta;
    }
    if (tailRotorRef.current) {
      tailRotorRef.current.rotation.x += rotorSpeed * safeDelta;
    }

    if (flightProgress.current < 1.0) {
      flightProgress.current = Math.min(1.0, flightProgress.current + safeDelta / 10.0);
      
      const t = flightProgress.current;
      const easeT = t * (2 - t);
      
      const currentPos = new THREE.Vector3().lerpVectors(startPos, targetPos, easeT);
      if (groupRef.current) {
        groupRef.current.position.copy(currentPos);
        
        const tilt = (1.0 - easeT) * 0.15;
        groupRef.current.rotation.x = tilt;
        
        const yaw = (1.0 - easeT) * (Math.PI / 4);
        groupRef.current.rotation.y = yaw;
      }

      if (flightProgress.current >= 1.0 && !landedCalled.current) {
        landedCalled.current = true;
        onLanded();
      }
    } else {
      if (groupRef.current) {
        groupRef.current.position.copy(targetPos);
        groupRef.current.rotation.set(0, 0, 0);
        
        const time = state.clock.getElapsedTime();
        groupRef.current.position.y = targetPos.y + Math.sin(time * 20.0) * 0.008;
      }
    }
  });

  if (!active) return null;

  return (
    <group ref={groupRef}>
      <primitive object={spotlightTarget} />
      
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.8, 1.8, 5.2]} />
        <meshStandardMaterial color="#2d3829" roughness={0.8} metalness={0.2} />
      </mesh>

      <mesh position={[0, 0.25, 2.3]} castShadow>
        <boxGeometry args={[1.5, 1.1, 1.4]} />
        <meshStandardMaterial color="#00ffdd" transparent opacity={0.5} roughness={0.1} metalness={0.9} />
      </mesh>

      <mesh position={[0, 0.3, -3.2]} castShadow>
        <cylinderGeometry args={[0.2, 0.45, 3.6, 8]} rotation={[Math.PI / 2, 0, 0]} />
        <meshStandardMaterial color="#2d3829" roughness={0.8} />
      </mesh>

      <mesh position={[0, 1.0, -4.8]} castShadow>
        <boxGeometry args={[0.15, 1.5, 0.8]} />
        <meshStandardMaterial color="#222b1e" />
      </mesh>

      <mesh position={[0, 1.05, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 0.5, 8]} />
        <meshStandardMaterial color="#111" metalness={0.8} />
      </mesh>

      <group ref={rotorRef} position={[0, 1.3, 0]}>
        <mesh castShadow>
          <boxGeometry args={[6.5, 0.02, 0.25]} />
          <meshStandardMaterial color="#151515" roughness={0.9} />
        </mesh>
        <mesh castShadow rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[6.5, 0.02, 0.25]} />
          <meshStandardMaterial color="#151515" roughness={0.9} />
        </mesh>
      </group>

      <group ref={tailRotorRef} position={[0.22, 1.3, -4.8]}>
        <mesh castShadow>
          <boxGeometry args={[0.02, 1.4, 0.12]} />
          <meshStandardMaterial color="#111" />
        </mesh>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[0.02, 1.4, 0.12]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      </group>

      <group position={[-1.0, -1.0, 0]}>
        <mesh position={[0, 0.2, 1.2]} rotation={[0, 0, -0.2]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.7]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[0, 0.2, -1.2]} rotation={[0, 0, -0.2]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.7]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[0, -0.15, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 4.8]} />
          <meshStandardMaterial color="#111" metalness={0.7} />
        </mesh>
      </group>

      <group position={[1.0, -1.0, 0]}>
        <mesh position={[0, 0.2, 1.2]} rotation={[0, 0, 0.2]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.7]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[0, 0.2, -1.2]} rotation={[0, 0, 0.2]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.7]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[0, -0.15, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 4.8]} />
          <meshStandardMaterial color="#111" metalness={0.7} />
        </mesh>
      </group>

      <spotLight
        position={[0, -0.8, 1.5]}
        angle={0.5}
        penumbra={0.6}
        intensity={6.0}
        color="#00ffdd"
        castShadow
        target={spotlightTarget}
      />
    </group>
  );
}

// 彈道雷射軌跡線
function TracerLine({ start, end, color = "#ff3b3b" }) {
  return (
    <Line
      points={[start, end]}
      color={color}
      lineWidth={2.0}
      transparent
      opacity={0.8}
    />
  );
}

// 敵軍血量條 (面朝相機看板 Billboard) — 依兵種類型顯示不同顏色
function EnemyHealthBar({ hp, maxHp, barColor, isAlly }) {
  const percent = Math.max(0, hp / (maxHp || 100));
  return (
    <group position={[0, 2.3, 0]}>
      {isAlly && (
        <Html position={[0, 0.25, 0]} center distanceFactor={12}>
          <div style={{
            background: 'rgba(0, 85, 170, 0.85)',
            color: '#00e5ff',
            fontFamily: 'monospace',
            fontWeight: 'bold',
            fontSize: '11px',
            padding: '2px 5px',
            borderRadius: '3px',
            border: '1px solid #00e5ff',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            userSelect: 'none'
          }}>
            DELTA 友軍
          </div>
        </Html>
      )}
      <mesh>
        <planeGeometry args={[1.0, 0.08]} />
        <meshBasicMaterial color="#333333" doubleSide />
      </mesh>
      {percent > 0 && (
        <mesh position={[-(1 - percent) * 0.5, 0, 0.005]}>
          <planeGeometry args={[percent, 0.06]} />
          <meshBasicMaterial color={isAlly ? '#00e5ff' : (barColor || '#00ff66')} doubleSide />
        </mesh>
      )}
    </group>
  );
}

// 3D 地面手榴彈預警圈
function GrenadeWarningCircle({ position, timeLeft, maxTime }) {
  const meshRef = useRef();
  const opacity = Math.abs(Math.sin(timeLeft * 8)) * 0.6 + 0.2;
  
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.material.opacity = opacity;
    }
  });

  return (
    <mesh ref={meshRef} position={[position.x, 0.05, position.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.3, 5.0, 32]} />
      <meshBasicMaterial color="#ff2200" transparent opacity={opacity} side={THREE.DoubleSide} />
    </mesh>
  );
}

// 敵方手榴彈 (橙紅色外觀，只傷害玩家)
function EnemyGrenade({ position, velocity, onExplode, targetPos }) {
  const meshRef = useRef();
  const vel = useRef(velocity.clone());
  const timer = useRef(2.5); // 2.5 秒定時引信
  const [ledColor, setLedColor] = useState('#ff4400');
  const [warningPos, setWarningPos] = useState(targetPos);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const pos = meshRef.current.position;

    timer.current -= delta;
    if (timer.current <= 0) {
      onExplode(pos.clone());
      return;
    }

    // 橙紅色 LED 快閃
    const flashIndex = Math.floor(state.clock.getElapsedTime() * 14) % 2;
    setLedColor(flashIndex === 0 ? '#ff4400' : '#2a0800');

    // 重力
    vel.current.y -= 9.8 * delta;
    // 位移
    pos.addScaledVector(vel.current, delta);
    // 旋轉
    meshRef.current.rotation.x += delta * 7;
    meshRef.current.rotation.y += delta * 4;

    // 更新預警圈位置 (投影到地面)
    setWarningPos(new THREE.Vector3(pos.x, 0, pos.z));

    // 地面碰撞彈跳
    if (pos.y <= 0.1) {
      pos.y = 0.1;
      if (Math.abs(vel.current.y) > 0.6) {
        vel.current.y = -vel.current.y * 0.4;
        vel.current.x *= 0.7;
        vel.current.z *= 0.7;
      } else {
        vel.current.y = 0;
        vel.current.x *= 0.85 * (1 - delta);
        vel.current.z *= 0.85 * (1 - delta);
      }
    }

    // 牆面碰撞
    const limit = 119;
    if (Math.abs(pos.x) >= limit) {
      pos.x = Math.sign(pos.x) * limit;
      vel.current.x = -vel.current.x * 0.5;
    }
    if (Math.abs(pos.z) >= limit) {
      pos.z = Math.sign(pos.z) * limit;
      vel.current.z = -vel.current.z * 0.5;
    }
  });

  return (
    <>
      {/* 地面預警圈 */}
      <GrenadeWarningCircle position={warningPos} timeLeft={timer.current} maxTime={2.5} />
      <group position={[position.x, position.y, position.z]} ref={meshRef}>
        {/* 橙紅色手榴彈球體 */}
        <mesh castShadow>
          <sphereGeometry args={[0.14, 10, 10]} />
          <meshStandardMaterial color="#8b3a00" roughness={0.85} />
        </mesh>
        {/* 金屬保險栓 */}
        <mesh position={[0, 0.13, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.06]} />
          <meshStandardMaterial color="#333" metalness={0.8} />
        </mesh>
        {/* 快閃的引信 LED 燈 */}
        <mesh position={[0, 0.08, 0.1]}>
          <sphereGeometry args={[0.03, 6, 6]} />
          <meshBasicMaterial color={ledColor} />
        </mesh>
      </group>
    </>
  );
}

// 戰術閃光彈眩暈星體特效 (Dizzy Stars)
function DizzyStars() {
  const groupRef = useRef();
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.getElapsedTime() * 5.0;
    }
  });
  return (
    <group ref={groupRef}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.22, 0.25, 8]} />
        <meshBasicMaterial color="#f1c40f" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0.25, 0.08, 0]}>
        <sphereGeometry args={[0.04, 4, 4]} />
        <meshBasicMaterial color="#f1c40f" />
      </mesh>
      <mesh position={[-0.25, 0.08, 0]}>
        <sphereGeometry args={[0.04, 4, 4]} />
        <meshBasicMaterial color="#ffff00" />
      </mesh>
    </group>
  );
}

// 檢查視線是否被戰術煙霧彈阻擋 (Line of Sight Blocked by Smoke Check)
const isLineBlockedBySmoke = (p1, p2, smokeClouds) => {
  if (!smokeClouds || smokeClouds.length === 0) return false;
  
  const d = new THREE.Vector3().subVectors(p2, p1);
  const len = d.length();
  if (len === 0) return false;
  d.normalize();
  
  const ac = new THREE.Vector3();
  const closestPoint = new THREE.Vector3();
  
  for (let i = 0; i < smokeClouds.length; i++) {
    const cloud = smokeClouds[i];
    // Check if either endpoint is inside the smoke cloud (proximity check)
    const distP1 = p1.distanceTo(cloud.position);
    const distP2 = p2.distanceTo(cloud.position);
    if (distP1 < cloud.radius || distP2 < cloud.radius) {
      return true;
    }
    
    // Project cloud center onto segment
    ac.subVectors(cloud.position, p1);
    let t = ac.dot(d);
    t = Math.max(0, Math.min(len, t));
    
    closestPoint.copy(p1).addScaledVector(d, t);
    const distToCloud = closestPoint.distanceTo(cloud.position);
    if (distToCloud < cloud.radius) {
      return true;
    }
  }
  return false;
};

// 戰術煙霧彈體積煙霧渲染組件 (Volumetric Smoke Cloud)
function SmokeCloud({ position, radius = 10.0, timeLeft }) {
  const groupRef = useRef();

  const spheres = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 18; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const r = Math.random() * (radius * 0.45);
      
      const x = Math.sin(phi) * Math.cos(theta) * r;
      const y = Math.random() * 2.2;
      const z = Math.sin(phi) * Math.sin(theta) * r;

      arr.push({
        id: i,
        offset: [x, y, z],
        size: radius * (0.35 + Math.random() * 0.25),
        speed: 0.1 + Math.random() * 0.15,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return arr;
  }, [radius]);

  const scaleFactor = Math.min(1.0, timeLeft / 1.5);
  const opacity = Math.min(0.12, (timeLeft / 12.0) * 0.12);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const time = state.clock.getElapsedTime();
    groupRef.current.rotation.y += delta * 0.05;
    
    const children = groupRef.current.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child && spheres[i]) {
        const breath = 1 + Math.sin(time * spheres[i].speed + spheres[i].phase) * 0.08;
        const scaleVal = breath * scaleFactor;
        child.scale.set(scaleVal, scaleVal, scaleVal);
      }
    }
  });

  return (
    <group ref={groupRef} position={[position.x, position.y, position.z]}>
      {spheres.map((s) => (
        <mesh key={s.id} position={s.offset}>
          <sphereGeometry args={[s.size, 16, 16]} />
          <meshBasicMaterial
            color="#95a5a6"
            transparent
            opacity={opacity}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// 敵軍 AI 組件
// 敵軍 AI 組件 (支援突擊、盾兵、擲彈、狙擊四兵種 AI 與精緻模型)
function Enemy({ data, onShootPlayer, onKilled, onThrowGrenade, smokeClouds = [], mapType, facilityEvent = 'normal', enemies = [], onShootEnemy }) {
  const meshRef = useRef();
  const healthBarRef = useRef();
  const [dyingRotation, setDyingRotation] = useState(0);
  const lastShotTime = useRef(0);

  const enemiesRef = useRef(enemies);
  useEffect(() => {
    enemiesRef.current = enemies;
  }, [enemies]);

  const facilityEventRef = useRef(facilityEvent);
  useEffect(() => {
    facilityEventRef.current = facilityEvent;
  }, [facilityEvent]);

  // 戰術閃光彈致盲眩暈本機倒數
  const localStunnedTimer = useRef(0);
  useEffect(() => {
    if (data.stunnedTimer > 0) {
      localStunnedTimer.current = data.stunnedTimer;
    }
  }, [data.stunnedTimer]);

  // 敵軍開火紅色射線狀態
  const [tracerVisible, setTracerVisible] = useState(false);
  const [tracerCoords, setTracerCoords] = useState({ start: [0, 0, 0], end: [0, 0, 0] });

  // 掩體尋求 AI 狀態變數
  const currentTarget = useRef(new THREE.Vector3());
  const coverTimer = useRef(0);
  const aiState = useRef('movingToCover'); // 'movingToCover', 'shootingFromCover', 'rushing'
  const stuckTime = useRef(0);
  
  // 突擊兵側移 strafe 用
  const strafeOffset = useRef(0);
  const strafeDir = useRef(1);

  // 取得兵種數值
  const stats = ENEMY_STATS[data.enemyType] || ENEMY_STATS.assault;

  // 戰術受擊阻滯與盲射狀態
  const prevHp = useRef(data.hp);
  const staggerTimer = useRef(0);
  const shootLockTimer = useRef(0);
  const staggerTilt = useRef(0);
  const staggerScaleY = useRef(1);
  const isBlindFiring = useRef(false);
  const blindFireLerp = useRef(0);

  useEffect(() => {
    if (data.hp < prevHp.current) {
      staggerTimer.current = 0.4;
      shootLockTimer.current = 0.2;
      staggerTilt.current = (Math.random() > 0.5 ? 1 : -1) * (0.15 + Math.random() * 0.1);
      staggerScaleY.current = 0.82;
    }
    prevHp.current = data.hp;
  }, [data.hp]);

  // 初始化尋求的掩體 (地面部隊: assault, grenadier) — 盾兵不使用掩體
  useEffect(() => {
    if (data.enemyType !== ENEMY_TYPES.SNIPER && data.enemyType !== ENEMY_TYPES.SHIELD) {
      const enemyPos = data.position;
      const activeCovers = getActiveCovers(mapType, facilityEvent);
      if (activeCovers.length > 0) {
        let closest = activeCovers[0];
        let minDist = closest.distanceTo(enemyPos);
        for (let i = 1; i < activeCovers.length; i++) {
          const d = activeCovers[i].distanceTo(enemyPos);
          if (d < minDist) {
            minDist = d;
            closest = activeCovers[i];
          }
        }
        currentTarget.current.copy(closest);
      }
    }
  }, [data.enemyType, data.position, mapType, facilityEvent]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    let activeColliders = mapType === 'facility' ? [...FACILITY_COLLIDERS] : [...STATIC_COLLIDERS];
    if (mapType === 'facility' && facilityEventRef.current === 'warp') {
      activeColliders = activeColliders.map(c => {
        const x_c = Math.sin(c.z * 0.04) * 6.0;
        const rotY = Math.atan(0.24 * Math.cos(c.z * 0.04));
        return {
          ...c,
          x: c.x + x_c,
          rotY
        };
      });
    }

    staggerTimer.current = Math.max(0, staggerTimer.current - delta);
    shootLockTimer.current = Math.max(0, shootLockTimer.current - delta);
    staggerTilt.current = THREE.MathUtils.lerp(staggerTilt.current, 0, 8.0 * delta);
    staggerScaleY.current = THREE.MathUtils.lerp(staggerScaleY.current, 1, 8.0 * delta);
    blindFireLerp.current = THREE.MathUtils.lerp(blindFireLerp.current, isBlindFiring.current ? 1.0 : 0.0, 6.0 * delta);

    if (meshRef.current) {
      meshRef.current.scale.set(1, staggerScaleY.current, 1);
      meshRef.current.rotation.z = (data.state === 'dying') ? dyingRotation : staggerTilt.current;
    }

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

    // 檢查閃光彈致盲狀態 (Check Flashbang Stun)
    if (localStunnedTimer.current > 0) {
      localStunnedTimer.current = Math.max(0, localStunnedTimer.current - delta);
      meshRef.current.rotation.y += delta * 5.0; // 旋轉失控
      if (healthBarRef.current) {
        healthBarRef.current.lookAt(state.camera.position);
      }
      return; // 略過移動與開火 AI
    }

    const enemyPos = meshRef.current.position;
    const playerPos = state.camera.position;
    const posBefore = enemyPos.clone();

    // Target Selection
    let targetEntity = null;
    let targetPos = null;
    let distToTarget = Infinity;

    if (data.isAlly) {
      let closestHostile = null;
      let minHDist = Infinity;
      enemiesRef.current.forEach((e) => {
        if (!e.isAlly && !e.isDummy && e.state === 'alive' && e.position) {
          const dist = enemyPos.distanceTo(e.position);
          if (dist < minHDist) {
            minHDist = dist;
            closestHostile = e;
          }
        }
      });
      if (closestHostile) {
        targetEntity = closestHostile;
        targetPos = closestHostile.position;
        distToTarget = minHDist;
      }
    } else {
      let closestAlly = null;
      let minADist = enemyPos.distanceTo(playerPos);
      enemiesRef.current.forEach((e) => {
        if (e.isAlly && e.state === 'alive' && e.position) {
          const dist = enemyPos.distanceTo(e.position);
          if (dist < minADist) {
            minADist = dist;
            closestAlly = e;
          }
        }
      });
      if (closestAlly) {
        targetEntity = closestAlly;
        targetPos = closestAlly.position;
        distToTarget = minADist;
      } else {
        targetEntity = 'player';
        targetPos = playerPos;
        distToTarget = minADist;
      }
    }

    // Face the target (or player if no target)
    const facePos = targetPos || playerPos;
    const angle = Math.atan2(facePos.x - enemyPos.x, facePos.z - enemyPos.z);
    meshRef.current.rotation.y = angle;

    if (healthBarRef.current) {
      healthBarRef.current.lookAt(playerPos);
    }

    // If no target (all hostiles dead for ally), just idle
    if (!targetEntity) {
      meshRef.current.position.y = 0;
      return;
    }

    // Aim position calculation
    const aimPos = targetEntity === 'player' 
      ? playerPos.clone().add(new THREE.Vector3(0, -0.2, 0)) 
      : targetPos.clone().add(new THREE.Vector3(0, 1.0, 0));

    // Custom helper to fire weapon at current target
    const fireWeaponAtTarget = (damage) => {
      if (targetEntity === 'player') {
        onShootPlayer(damage, enemyPos);
      } else if (onShootEnemy) {
        onShootEnemy(data.id, targetEntity.id, damage);
      }
    };

    // ========== 狙擊手 AI ==========
    if (data.enemyType === ENEMY_TYPES.SNIPER) {
      if (distToTarget <= stats.range) {
        const now = state.clock.getElapsedTime();
        const cooldown = stats.cooldown + Math.random() * 1.5;
        if (shootLockTimer.current <= 0 && now - lastShotTime.current > cooldown) {
          lastShotTime.current = now;

          const raycastStart = new THREE.Vector3(0, 1.5, 0).add(enemyPos);
          
          let blocked = isLineBlockedBySmoke(raycastStart, aimPos, smokeClouds);
          if (!blocked) {
            const direction = new THREE.Vector3().subVectors(aimPos, raycastStart);
            const distToTargetLen = direction.length();
            direction.normalize();

            const raycaster = new THREE.Raycaster(raycastStart, direction, 0, distToTargetLen);
            const intersects = raycaster.intersectObjects(state.scene.children, true);
            
            for (let i = 0; i < intersects.length; i++) {
              const hit = intersects[i];
              if (hit.distance < 0.8) continue;

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

              if (hit.distance < distToTargetLen - 0.5) {
                blocked = true;
                break;
              }
            }
          }

          if (!blocked) {
            fireWeaponAtTarget(stats.damage);

            const startPos = new THREE.Vector3(0.25, 1.12, 1.15).applyMatrix4(meshRef.current.matrixWorld);
            setTracerCoords({
              start: [startPos.x, startPos.y, startPos.z],
              end: [aimPos.x, aimPos.y, aimPos.z],
            });
            setTracerVisible(true);
            setTimeout(() => setTracerVisible(false), 90);
          }
        }
      }
    }
    // ========== 盾兵 AI ==========
    else if (data.enemyType === ENEMY_TYPES.SHIELD) {
      // 盾兵不使用掩體，始終朝目標緩步推進
      if (distToTarget > 4) {
        const dir = new THREE.Vector3().subVectors(targetPos, enemyPos);
        dir.y = 0;
        dir.normalize();
        const currentSpeed = (staggerTimer.current > 0 ? stats.speed * 0.35 : stats.speed);
        enemyPos.addScaledVector(dir, currentSpeed * delta);
        meshRef.current.position.y = Math.abs(Math.sin(state.clock.getElapsedTime() * 4.0)) * 0.04;
      } else {
        meshRef.current.position.y = 0;
      }

      // 近距離開火
      if (distToTarget <= stats.range) {
        const now = state.clock.getElapsedTime();
        if (shootLockTimer.current <= 0 && now - lastShotTime.current > stats.cooldown) {
          lastShotTime.current = now;

          const raycastStart = new THREE.Vector3(0, 1.5, 0).add(enemyPos);
          
          let blocked = isLineBlockedBySmoke(raycastStart, aimPos, smokeClouds);
          if (!blocked) {
            const direction = new THREE.Vector3().subVectors(aimPos, raycastStart);
            const distToTargetLen = direction.length();
            direction.normalize();

            const raycaster = new THREE.Raycaster(raycastStart, direction, 0, distToTargetLen);
            const intersects = raycaster.intersectObjects(state.scene.children, true);
            
            for (let i = 0; i < intersects.length; i++) {
              const hit = intersects[i];
              if (hit.distance < 0.8) continue;
              let parent = hit.object;
              let isSelfOrEnemy = false;
              let isCosmetic = false;
              while (parent) {
                if (parent.userData && (parent.userData.isEnemy || parent.userData.isDummy)) { isSelfOrEnemy = true; break; }
                if (parent.name === 'weapon' || parent.name === 'player' || parent.name === 'bullet_hole' || parent.name === 'tracer' || parent.name === 'casing' || parent.name === 'magazine') { isCosmetic = true; break; }
                parent = parent.parent;
              }
              if (isSelfOrEnemy || isCosmetic) continue;
              if (hit.distance < distToTargetLen - 0.5) { blocked = true; break; }
            }
          }

          if (!blocked) {
            const isHit = Math.random() < stats.hitRate;
            const startPos = new THREE.Vector3(0.3, 1.1, 0.9).applyMatrix4(meshRef.current.matrixWorld);
            let targetCoords = aimPos.clone();
            
            if (isHit) {
              fireWeaponAtTarget(stats.damage);
            } else {
              targetCoords.add(new THREE.Vector3(
                (Math.random() - 0.5) * 3.0,
                (Math.random() - 0.5) * 2.0,
                (Math.random() - 0.5) * 3.0
              ));
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

      enemyPos.x = Math.max(-118, Math.min(118, enemyPos.x));
      enemyPos.z = Math.max(-118, Math.min(118, enemyPos.z));
    }
    // ========== 擲彈兵 AI ==========
    else if (data.enemyType === ENEMY_TYPES.GRENADIER) {
      const currentSpeed = (staggerTimer.current > 0 ? stats.speed * 0.35 : stats.speed);
      const currentRushSpeed = (staggerTimer.current > 0 ? stats.rushSpeed * 0.35 : stats.rushSpeed);
      const activeCovers = getActiveCovers(mapType, facilityEventRef.current);

      if (aiState.current === 'movingToCover') {
        const distToCover = enemyPos.distanceTo(currentTarget.current);
        if (distToCover > 0.5) {
          const dir = new THREE.Vector3().subVectors(currentTarget.current, enemyPos);
          dir.y = 0;
          dir.normalize();
          enemyPos.addScaledVector(dir, currentSpeed * delta);
          meshRef.current.position.y = Math.abs(Math.sin(state.clock.getElapsedTime() * 9.0)) * 0.12;
        } else {
          aiState.current = 'shootingFromCover';
          coverTimer.current = 4.0 + Math.random() * 2.0;
          if (data.hp < stats.hp * 0.5 && Math.random() < 0.4) {
            isBlindFiring.current = true;
          } else {
            isBlindFiring.current = false;
          }
        }
      } else if (aiState.current === 'shootingFromCover') {
        meshRef.current.position.y = 0;
        coverTimer.current -= delta;

        if (isBlindFiring.current) {
          const now = state.clock.getElapsedTime();
          const cooldown = 0.8 + Math.random() * 0.5;
          if (shootLockTimer.current <= 0 && now - lastShotTime.current > cooldown) {
            lastShotTime.current = now;
            const startPos = new THREE.Vector3(0.25, 1.12, 0.95).applyMatrix4(meshRef.current.matrixWorld);
            const endPos = aimPos.clone();
            
            const isHit = Math.random() < 0.08;
            let targetCoords = endPos.clone();
            if (isHit) {
              fireWeaponAtTarget(10);
            } else {
              const offset = new THREE.Vector3(
                (Math.random() - 0.5) * 12.0,
                (Math.random() - 0.5) * 6.0,
                (Math.random() - 0.5) * 12.0
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

        if (coverTimer.current <= 0) {
          isBlindFiring.current = false;
          if (distToTarget > 18) {
            let bestCover = currentTarget.current;
            let bestDist = bestCover.distanceTo(targetPos);
            for (let i = 0; i < activeCovers.length; i++) {
              const dToTarget = activeCovers[i].distanceTo(targetPos);
              const dToEnemy = activeCovers[i].distanceTo(enemyPos);
              if (dToTarget < distToTarget && dToEnemy < 60) {
                if (dToTarget < bestDist) {
                  bestDist = dToTarget;
                  bestCover = activeCovers[i];
                }
              }
            }
            currentTarget.current.copy(bestCover);
            aiState.current = 'movingToCover';
          } else {
            aiState.current = 'rushing';
          }
        }
      } else {
        if (distToTarget > 8) {
          const dir = new THREE.Vector3().subVectors(targetPos, enemyPos);
          dir.y = 0;
          dir.normalize();
          enemyPos.addScaledVector(dir, currentRushSpeed * delta);
          meshRef.current.position.y = Math.abs(Math.sin(state.clock.getElapsedTime() * 9.0)) * 0.12;
        } else {
          meshRef.current.position.y = 0;
        }
      }

      if (distToTarget <= stats.range && distToTarget > 8 && !isBlindFiring.current && shootLockTimer.current <= 0) {
        const now = state.clock.getElapsedTime();
        if (now - lastShotTime.current > stats.cooldown) {
          lastShotTime.current = now;

          const raycastStart = new THREE.Vector3(0, 1.5, 0).add(enemyPos);
          
          let blocked = isLineBlockedBySmoke(raycastStart, aimPos, smokeClouds);
          if (!blocked) {
            const direction = new THREE.Vector3().subVectors(aimPos, raycastStart);
            const distToTargetLen = direction.length();
            direction.normalize();

            const raycaster = new THREE.Raycaster(raycastStart, direction, 0, distToTargetLen);
            const intersects = raycaster.intersectObjects(state.scene.children, true);
            
            for (let i = 0; i < intersects.length; i++) {
              const hit = intersects[i];
              if (hit.distance < 0.8) continue;
              let parent = hit.object;
              let isSelfOrEnemy = false;
              let isCosmetic = false;
              while (parent) {
                if (parent.userData && (parent.userData.isEnemy || parent.userData.isDummy)) { isSelfOrEnemy = true; break; }
                if (parent.name === 'weapon' || parent.name === 'player' || parent.name === 'bullet_hole' || parent.name === 'tracer' || parent.name === 'casing' || parent.name === 'magazine') { isCosmetic = true; break; }
                parent = parent.parent;
              }
              if (isSelfOrEnemy || isCosmetic) continue;
              if (hit.distance < distToTargetLen - 0.5) { blocked = true; break; }
            }
          }

          if (!blocked && onThrowGrenade) {
            const throwStart = new THREE.Vector3(0, 1.8, 0).add(enemyPos);
            const toTarget = new THREE.Vector3().subVectors(targetPos, throwStart);
            const horizontalDist = Math.sqrt(toTarget.x * toTarget.x + toTarget.z * toTarget.z);
            const throwSpeed = Math.sqrt(horizontalDist * 9.8);
            const throwDir = toTarget.clone();
            throwDir.y = 0;
            throwDir.normalize();
            
            const throwVelocity = new THREE.Vector3(
              throwDir.x * throwSpeed,
              throwSpeed * 0.7,
              throwDir.z * throwSpeed
            );
            
            onThrowGrenade(throwStart, throwVelocity, targetPos);
          }
        }
      }

      enemyPos.x = Math.max(-118, Math.min(118, enemyPos.x));
      enemyPos.z = Math.max(-118, Math.min(118, enemyPos.z));
    }
    // ========== 突擊兵 AI (包含 Special Forces 友軍 AI) ==========
    else {
      const activeCovers = getActiveCovers(mapType, facilityEventRef.current);
      if (aiState.current === 'movingToCover') {
        const distToCover = enemyPos.distanceTo(currentTarget.current);
        if (distToCover > 0.5) {
          const dir = new THREE.Vector3().subVectors(currentTarget.current, enemyPos);
          dir.y = 0;
          dir.normalize();
          enemyPos.addScaledVector(dir, stats.speed * delta);
          meshRef.current.position.y = Math.abs(Math.sin(state.clock.getElapsedTime() * 10.0)) * 0.14;
        } else {
          aiState.current = 'shootingFromCover';
          coverTimer.current = 3.0 + Math.random() * 2.0;
        }
      } else if (aiState.current === 'shootingFromCover') {
        coverTimer.current -= delta;
        
        strafeOffset.current += delta * 1.5 * strafeDir.current;
        if (Math.abs(strafeOffset.current) > 1.2) {
          strafeDir.current = -strafeDir.current;
        }
        
        const strafeVec = new THREE.Vector3(
          Math.sin(angle + Math.PI / 2) * strafeOffset.current,
          0,
          Math.cos(angle + Math.PI / 2) * strafeOffset.current
        );
        meshRef.current.position.y = Math.abs(Math.sin(state.clock.getElapsedTime() * 5.0)) * 0.05;
        
        if (coverTimer.current <= 0) {
          strafeOffset.current = 0;
          if (distToTarget > 18) {
            let bestCover = currentTarget.current;
            let bestScore = -Infinity;
            
            const toTarget = new THREE.Vector3().subVectors(targetPos, enemyPos).normalize();
            
            for (let i = 0; i < activeCovers.length; i++) {
              const coverPos = activeCovers[i];
              const dToEnemy = coverPos.distanceTo(enemyPos);
              const dToTarget = coverPos.distanceTo(targetPos);
              
              if (dToEnemy < 60 && dToTarget < distToTarget) {
                const toCover = new THREE.Vector3().subVectors(coverPos, enemyPos).normalize();
                const cosVal = Math.abs(toCover.dot(toTarget)); 
                const flankScore = (1.0 - cosVal) * 50.0;
                const distScore = (60.0 - dToEnemy) * 0.5;
                const totalScore = flankScore + distScore;
                
                if (totalScore > bestScore) {
                  bestScore = totalScore;
                  bestCover = coverPos;
                }
              }
            }
            currentTarget.current.copy(bestCover);
            aiState.current = 'movingToCover';
          } else {
            aiState.current = 'rushing';
          }
        }
      } else {
        if (distToTarget > 8) {
          const dir = new THREE.Vector3().subVectors(targetPos, enemyPos);
          dir.y = 0;
          dir.normalize();
          enemyPos.addScaledVector(dir, stats.rushSpeed * delta);
          meshRef.current.position.y = Math.abs(Math.sin(state.clock.getElapsedTime() * 12.0)) * 0.16;
        } else {
          meshRef.current.position.y = 0;
        }
      }

      if (distToTarget <= stats.range) {
        const now = state.clock.getElapsedTime();
        const cooldown = stats.cooldown + Math.random() * 0.7;
        if (now - lastShotTime.current > cooldown) {
          lastShotTime.current = now;

          const raycastStart = new THREE.Vector3(0, 1.5, 0).add(enemyPos);
          
          let blocked = isLineBlockedBySmoke(raycastStart, aimPos, smokeClouds);
          if (!blocked) {
            const direction = new THREE.Vector3().subVectors(aimPos, raycastStart);
            const distToTargetLen = direction.length();
            direction.normalize();

            const raycaster = new THREE.Raycaster(raycastStart, direction, 0, distToTargetLen);
            const intersects = raycaster.intersectObjects(state.scene.children, true);
            
            for (let i = 0; i < intersects.length; i++) {
              const hit = intersects[i];
              if (hit.distance < 0.8) continue;
              let parent = hit.object;
              let isSelfOrEnemy = false;
              let isCosmetic = false;
              while (parent) {
                if (parent.userData && (parent.userData.isEnemy || parent.userData.isDummy)) { isSelfOrEnemy = true; break; }
                if (parent.name === 'weapon' || parent.name === 'player' || parent.name === 'bullet_hole' || parent.name === 'tracer' || parent.name === 'casing' || parent.name === 'magazine') { isCosmetic = true; break; }
                parent = parent.parent;
              }
              if (isSelfOrEnemy || isCosmetic) continue;
              if (hit.distance < distToTargetLen - 0.5) { blocked = true; break; }
            }
          }

          if (!blocked) {
            const isHit = Math.random() < stats.hitRate;
            const startPos = new THREE.Vector3(0.25, 1.12, 0.95).applyMatrix4(meshRef.current.matrixWorld);
            let targetCoords = aimPos.clone();
            
            if (isHit) {
              fireWeaponAtTarget(stats.damage);
            } else {
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

      enemyPos.x = Math.max(-118, Math.min(118, enemyPos.x));
      enemyPos.z = Math.max(-118, Math.min(118, enemyPos.z));
    }

    if (data.enemyType !== ENEMY_TYPES.SNIPER) {
      const enemyRadius = data.enemyType === ENEMY_TYPES.SHIELD ? 0.45 : 0.35;
      for (let i = 0; i < activeColliders.length; i++) {
        const c = activeColliders[i];
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

    if (data.enemyType !== ENEMY_TYPES.SNIPER) {
      const posAfter = enemyPos.clone();
      const actualMoveDist = posAfter.distanceTo(posBefore);
      const expectedSpeed = aiState.current === 'rushing' ? (stats.rushSpeed || 4.0) : (stats.speed || 2.0);
      const activeCovers = getActiveCovers(mapType, facilityEventRef.current);
      
      if (aiState.current === 'movingToCover' || aiState.current === 'rushing') {
        if (actualMoveDist < expectedSpeed * delta * 0.15) {
          stuckTime.current += delta;
        } else {
          stuckTime.current = Math.max(0, stuckTime.current - delta * 0.5);
        }

        if (stuckTime.current > 1.2) {
          stuckTime.current = 0;
          if (aiState.current === 'movingToCover') {
            if (Math.random() < 0.5) {
              aiState.current = 'rushing';
            } else {
              if (activeCovers.length > 0) {
                const randCover = activeCovers[Math.floor(Math.random() * activeCovers.length)];
                currentTarget.current.copy(randCover);
              }
            }
          } else if (aiState.current === 'rushing') {
            if (activeCovers.length > 0) {
              const randCover = activeCovers[Math.floor(Math.random() * activeCovers.length)];
              currentTarget.current.copy(randCover);
              aiState.current = 'movingToCover';
            }
          }
        }
      }
    }

    if (mapType === 'facility') {
      if (facilityEventRef.current === 'warp') {
        const x_c = Math.sin(enemyPos.z * 0.04) * 6.0;
        enemyPos.x = Math.max(x_c - 3.6, Math.min(x_c + 3.6, enemyPos.x));
      } else {
        enemyPos.x = Math.max(-3.6, Math.min(3.6, enemyPos.x));
      }
      enemyPos.z = Math.max(-115, Math.min(115, enemyPos.z));
    }
  });

  // ========== 視覺模型 (依兵種分化) ==========
  return (
    <>
      <group
        position={[data.position.x, data.position.y, data.position.z]}
        ref={meshRef}
        userData={{ isEnemy: true, enemyId: data.id, enemyType: data.enemyType, isDying: data.state === 'dying' }}
      >
        {/* 敵軍主體 */}
        <mesh position={[0, 0.9, 0]} castShadow>
          <cylinderGeometry args={[
            data.enemyType === ENEMY_TYPES.SHIELD ? 0.4 : 0.3,
            data.enemyType === ENEMY_TYPES.SHIELD ? 0.45 : 0.35,
            data.enemyType === ENEMY_TYPES.SHIELD ? 1.5 : 1.4,
            8
          ]} />
          <meshStandardMaterial color={data.isAlly ? '#00e5ff' : stats.bodyColor} roughness={0.7} />
        </mesh>
        
        {/* 敵軍頭部 */}
        <mesh position={[0, 1.8, 0]} castShadow>
          <sphereGeometry args={[0.26, 8, 8]} />
          <meshStandardMaterial color="#e0a890" roughness={0.8} />
        </mesh>

        {/* 粗壯戰術頭盔 (狙擊手與其他兵種皆戴，顏色不同) */}
        <mesh position={[0, 1.9, 0]} castShadow>
          <sphereGeometry args={[0.28, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={data.isAlly ? '#0055aa' : (data.isElite ? '#d4af37' : stats.helmetColor)} roughness={data.isElite ? 0.2 : 0.9} metalness={data.isElite ? 0.8 : 0.0} />
        </mesh>

        {/* 戰術面罩 (突擊兵專屬) */}
        {data.enemyType === ENEMY_TYPES.ASSAULT && (
          <mesh position={[0, 1.72, 0.22]} castShadow>
            <boxGeometry args={[0.22, 0.12, 0.08]} />
            <meshStandardMaterial color="#111111" metalness={0.5} roughness={0.4} />
          </mesh>
        )}

        {/* 投擲手榴彈袋 (擲彈兵專屬) */}
        {data.enemyType === ENEMY_TYPES.GRENADIER && (
          <group>
            {/* 斜背帶 */}
            <mesh position={[0.15, 1.0, -0.15]} rotation={[0, 0, -0.5]} castShadow>
              <boxGeometry args={[0.08, 0.9, 0.04]} />
              <meshStandardMaterial color="#5a4a2a" roughness={0.9} />
            </mesh>
            {/* 手榴彈 x3 */}
            {[0, 0.2, 0.4].map((offset, i) => (
              <mesh key={i} position={[-0.28, 0.7 + offset, -0.12]} castShadow>
                <sphereGeometry args={[0.07, 6, 6]} />
                <meshStandardMaterial color="#3d4a2d" roughness={0.85} />
              </mesh>
            ))}
          </group>
        )}

        {/* 盾兵專屬：半透明能量盾 */}
        {data.enemyType === ENEMY_TYPES.SHIELD && (
          <group position={[0, 0.9, 0.55]}>
            {/* 盾牌主體 */}
            <mesh castShadow>
              <boxGeometry args={[0.9, 1.6, 0.06]} />
              <meshPhysicalMaterial 
                color="#00aaff" 
                transparent 
                opacity={0.35} 
                roughness={0.1} 
                metalness={0.3}
                emissive="#003366"
                emissiveIntensity={0.3}
              />
            </mesh>
            {/* 盾牌邊框 */}
            <mesh position={[0, 0, 0.035]}>
              <boxGeometry args={[0.95, 1.65, 0.02]} />
              <meshStandardMaterial color="#0066aa" transparent opacity={0.5} wireframe />
            </mesh>
            {/* 能量光源 */}
            <pointLight color="#00aaff" intensity={1.5} distance={4} />
          </group>
        )}

        {/* 敵軍武器 */}
        <group position={[0.25, 1.1, 0.3]} rotation={[0, 0, 0]}>
          {/* 槍身 (Receiver) */}
          <mesh castShadow position={[0, 0.02, 0.15]}>
            <boxGeometry args={[0.06, 0.1, 0.5]} />
            <meshStandardMaterial color="#222222" metalness={0.7} roughness={0.3} />
          </mesh>
          {/* 槍管 (Barrel) */}
          <mesh castShadow position={[0, 0.04, 0.45]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.015, 0.015, data.enemyType === ENEMY_TYPES.SNIPER ? 0.8 : 0.4]} />
            <meshStandardMaterial color="#111111" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* 彈匣 (Magazine) */}
          <mesh castShadow position={[0, -0.08, 0.25]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[0.04, 0.16, 0.08]} />
            <meshStandardMaterial color="#151515" metalness={0.5} roughness={0.5} />
          </mesh>
          {/* 槍托 (Stock) */}
          <mesh castShadow position={[0, -0.02, -0.2]}>
            <boxGeometry args={[0.05, 0.08, 0.25]} />
            <meshStandardMaterial color="#443322" roughness={0.9} />
          </mesh>
          {/* 瞄準鏡 (Scope) - 狙擊手專屬 */}
          {data.enemyType === ENEMY_TYPES.SNIPER && (
            <group position={[0, 0.1, 0.15]}>
              <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.022, 0.022, 0.35]} />
                <meshStandardMaterial color="#333333" metalness={0.6} />
              </mesh>
              {/* 支架 */}
              <mesh castShadow position={[0, -0.04, 0]}>
                <boxGeometry args={[0.02, 0.05, 0.1]} />
                <meshStandardMaterial color="#111111" />
              </mesh>
            </group>
          )}
        </group>

        {/* 戰術閃光彈致盲眩暈特效 */}
        {localStunnedTimer.current > 0 && (
          <group position={[0, 2.15, 0]}>
            <DizzyStars />
          </group>
        )}

        <group ref={healthBarRef}>
          <EnemyHealthBar hp={data.hp} maxHp={stats.hp} barColor={stats.hpBarColor} isAlly={data.isAlly} />
        </group>
      </group>

      {tracerVisible && (
        <TracerLine start={tracerCoords.start} end={tracerCoords.end} color={data.isAlly ? "#00e5ff" : "#ff3b3b"} />
      )}
    </>
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
const getWarpPosAndRot = (origX, origY, origZ, origRotY, facilityEvent) => {
  if (facilityEvent !== 'warp') {
    return { position: [origX, origY, origZ], rotation: [0, origRotY, 0] };
  }
  const z = origZ;
  const x_c = Math.sin(z * 0.04) * 6.0;
  const rotY = Math.atan(0.24 * Math.cos(z * 0.04));
  const newX = x_c + origX * Math.cos(rotY);
  const newZ = z - origX * Math.sin(rotY);
  return {
    position: [newX, origY, newZ],
    rotation: [0, origRotY + rotY, 0]
  };
};

const FACILITY_COVERS = [
  new THREE.Vector3(-1.8, 0, -40),
  new THREE.Vector3(1.5, 0, -10),
  new THREE.Vector3(-1.2, 0, 15),
  new THREE.Vector3(1.6, 0, 45),
  new THREE.Vector3(0, 0, -85)
];

const getActiveCovers = (mapType, facilityEvent) => {
  if (mapType === 'facility') {
    if (facilityEvent === 'warp') {
      return FACILITY_COVERS.map(c => {
        const z = c.z;
        const x_c = Math.sin(z * 0.04) * 6.0;
        const rotY = Math.atan(0.24 * Math.cos(z * 0.04));
        const newX = x_c + c.x * Math.cos(rotY);
        const newZ = z - c.x * Math.sin(rotY);
        return new THREE.Vector3(newX, 0, newZ);
      });
    }
    return FACILITY_COVERS;
  }
  return COVERS;
};

function Ground({ mapType, facilityEvent = 'normal' }) {
  const isFacility = mapType === 'facility';
  const groundColor = isFacility ? '#e0e4e8' : '#2d3527';
  const gridColor1 = isFacility ? '#cccccc' : '#00ff66';
  const gridColor2 = isFacility ? '#dddddd' : '#142517';

  // Reusable materials to optimize performance
  const groundMaterial = new THREE.MeshStandardMaterial({ color: groundColor, roughness: 0.75 });
  const tactileMaterial = new THREE.MeshStandardMaterial({ color: "#f39c12", roughness: 0.8, flatShading: true });
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: "#eceff1", roughness: 0.9 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: "#fafafa", roughness: 0.35, metalness: 0.05 });

  if (isFacility && facilityEvent === 'warp') {
    const SEGMENT_LEN = 5;
    const numSegments = 240 / SEGMENT_LEN;
    const segments = [];
    for (let i = 0; i < numSegments; i++) {
      const z = -120 + (i + 0.5) * SEGMENT_LEN;
      const x_c = Math.sin(z * 0.04) * 6.0;
      const rotY = Math.atan(0.24 * Math.cos(z * 0.04));
      segments.push({ z, x: x_c, rotY });
    }

    return (
      <group>
        {segments.map((seg, idx) => (
          <group key={idx} position={[seg.x, 0, seg.z]} rotation={[0, seg.rotY, 0]}>
            {/* Ground Segment */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={groundMaterial}>
              <planeGeometry args={[8, SEGMENT_LEN]} />
            </mesh>

            {/* Tactile guide Segment */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow material={tactileMaterial}>
              <planeGeometry args={[0.4, SEGMENT_LEN]} />
            </mesh>

            {/* Ground grid helper scaled */}
            <gridHelper args={[8, 8, '#b2bec3', '#dfe6e9']} position={[0, 0.001, 0]} scale={[1, 1, SEGMENT_LEN / 8]} />

            {/* Ceiling Segment */}
            <mesh position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow material={ceilingMaterial}>
              <planeGeometry args={[8, SEGMENT_LEN]} />
            </mesh>
            <gridHelper args={[8, 8, '#b0bec5', '#cfd8dc']} position={[0, 4.98, 0]} scale={[1, 1, SEGMENT_LEN / 8]} />

            {/* Left Wall Segment */}
            <mesh position={[-4, 2.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow castShadow material={wallMaterial}>
              <planeGeometry args={[SEGMENT_LEN, 5]} />
            </mesh>
            <gridHelper args={[5, 5, '#b2bec3', '#dfe6e9']} position={[-3.995, 2.5, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, SEGMENT_LEN / 5]} />

            {/* Right Wall Segment */}
            <mesh position={[4, 2.5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow castShadow material={wallMaterial}>
              <planeGeometry args={[SEGMENT_LEN, 5]} />
            </mesh>
            <gridHelper args={[5, 5, '#b2bec3', '#dfe6e9']} position={[3.995, 2.5, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, SEGMENT_LEN / 5]} />
          </group>
        ))}
      </group>
    );
  }

  return (
    <group>
      {/* 渲染草地或地鐵通道瓷磚地表 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={isFacility ? [8, 240] : [250, 250]} />
        <meshStandardMaterial color={groundColor} roughness={0.75} />
      </mesh>
      
      {/* 地鐵特有輔助線與結構 */}
      {isFacility && (
        <>
          {/* 黃色盲道引導磚 */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
            <planeGeometry args={[0.4, 240]} />
            <meshStandardMaterial color="#f39c12" roughness={0.8} flatShading />
          </mesh>
          <gridHelper args={[240, 240, '#b2bec3', '#dfe6e9']} position={[0, 0.001, 0]} />
          
          {/* 天花板 */}
          <mesh position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[8, 240]} />
            <meshStandardMaterial color="#eceff1" roughness={0.9} />
          </mesh>
          <gridHelper args={[240, 120, '#b0bec5', '#cfd8dc']} position={[0, 4.98, 0]} />

          {/* 瓷磚側壁 (左右高 5 米) */}
          {/* 左側壁 */}
          <mesh position={[-4, 2.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow castShadow>
            <planeGeometry args={[240, 5]} />
            <meshStandardMaterial color="#fafafa" roughness={0.35} metalness={0.05} />
          </mesh>
          <gridHelper args={[240, 240, '#b2bec3', '#dfe6e9']} position={[-3.995, 2.5, 0]} rotation={[0, 0, Math.PI / 2]} />

          {/* 右側壁 */}
          <mesh position={[4, 2.5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow castShadow>
            <planeGeometry args={[240, 5]} />
            <meshStandardMaterial color="#fafafa" roughness={0.35} metalness={0.05} />
          </mesh>
          <gridHelper args={[240, 240, '#b2bec3', '#dfe6e9']} position={[3.995, 2.5, 0]} rotation={[0, 0, Math.PI / 2]} />
        </>
      )}

      {/* 草地 gridHelper */}
      {!isFacility && (
        <gridHelper args={[240, 120, gridColor1, gridColor2]} position={[0, 0.01, 0]} />
      )}
    </group>
  );
}

function ShutterDoor({ open, position = [0, 2.5, -120], rotation = [0, 0, 0] }) {
  const meshRef = useRef();
  const animYRef = useRef(position[1]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const targetY = open ? 7.5 : 2.5;
    animYRef.current = THREE.MathUtils.lerp(animYRef.current, targetY, 4.0 * Math.min(delta, 0.1));
    meshRef.current.position.y = animYRef.current;
    meshRef.current.position.x = position[0];
    meshRef.current.position.z = position[2];
  });

  return (
    <mesh ref={meshRef} position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={[8, 5, 0.4]} />
      <meshStandardMaterial color="#2f3640" roughness={0.6} metalness={0.8} />
    </mesh>
  );
}

function PerimeterWalls({ mapType, facilityZone = 8, enemies = [], facilityEvent = 'normal' }) {
  const isFacility = mapType === 'facility';
  const wallColor = isFacility ? '#2c3e50' : '#1a1f18';
  
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: wallColor,
    roughness: 0.9,
    flatShading: true,
  });

  if (isFacility) {
    const aliveCount = enemies.filter(e => e.state === 'alive' && !e.isAlly).length;
    const isDoorOpen = facilityZone === 1 && aliveCount === 0;

    const shutterWarp = getWarpPosAndRot(0, 2.5, -120, 0, facilityEvent);
    const rearWallWarp = getWarpPosAndRot(0, 2.5, 120, 0, facilityEvent);

    return (
      <group>
        {/* 前端鋼製封口 (平滑滑動鐵捲門) */}
        <ShutterDoor open={isDoorOpen} position={shutterWarp.position} rotation={shutterWarp.rotation} />
        {/* 後端鋼製封口 */}
        <mesh position={rearWallWarp.position} rotation={rearWallWarp.rotation} castShadow receiveShadow>
          <boxGeometry args={[8, 5, 0.4]} />
          <meshStandardMaterial color="#2f3640" roughness={0.6} metalness={0.8} />
        </mesh>
      </group>
    );
  }

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

function OutpostAssets() {
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

function SubwayFluorescentLight({ position, rotation = [0, 0, 0], castShadow = false, facilityEvent = 'normal' }) {
  let lightColor = '#ffffff';
  let lightIntensity = 2.5;
  let tubeColor = '#ffffff';

  if (facilityEvent === 'blackout') {
    lightIntensity = 0.0;
    tubeColor = '#1e272e';
  } else if (facilityEvent === 'alert') {
    lightColor = '#ff3333';
    lightIntensity = 2.0;
    tubeColor = '#ff3333';
  }

  return (
    <group position={position} rotation={rotation}>
      {/* 燈具外殼 */}
      <mesh>
        <boxGeometry args={[1.5, 0.05, 0.25]} />
        <meshStandardMaterial color="#353b48" roughness={0.5} />
      </mesh>
      {/* 燈管部分 */}
      <mesh position={[0, -0.03, 0]}>
        <boxGeometry args={[1.4, 0.02, 0.18]} />
        <meshBasicMaterial color={tubeColor} />
      </mesh>
      {/* 點光源：限制日光燈 shadows 以防止 WebGL 崩潰 */}
      {lightIntensity > 0 && (
        <pointLight 
          color={lightColor} 
          intensity={lightIntensity} 
          distance={24} 
          decay={1.4} 
          castShadow={castShadow} 
          shadow-mapSize-width={512} 
          shadow-mapSize-height={512} 
        />
      )}
    </group>
  );
}

function ExitSign({ position, rotation = [0, 0, 0], number = 8 }) {
  return (
    <group position={position} rotation={rotation}>
      {/* 出口指示牌外框 */}
      <mesh castShadow>
        <boxGeometry args={[3.2, 0.7, 0.15]} />
        <meshStandardMaterial color="#ffd200" roughness={0.2} metalness={0.1} />
      </mesh>
      {/* 吊桿 */}
      <mesh position={[-1.0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 1.0, 6]} />
        <meshStandardMaterial color="#2f3640" />
      </mesh>
      <mesh position={[1.0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 1.0, 6]} />
        <meshStandardMaterial color="#2f3640" />
      </mesh>
      {/* 出口標記 */}
      <Html position={[0, 0, 0.08]} transform center distanceFactor={7}>
        <div style={{
          background: '#ffd200',
          color: '#000000',
          fontFamily: '"Helvetica Neue", Arial, sans-serif',
          fontWeight: 'bold',
          fontSize: '22px',
          width: '300px',
          textAlign: 'center',
          padding: '4px 8px',
          border: '2px solid #000',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '12px',
          userSelect: 'none'
        }}>
          <span style={{ fontSize: '30px' }}>出口</span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div style={{ fontSize: '18px', lineHeight: '20px' }}>出口 <span style={{ fontSize: '26px' }}>{number}</span></div>
            <div style={{ fontSize: '11px', lineHeight: '11px', letterSpacing: '0.5px' }}>Exit {number}</div>
          </div>
        </div>
      </Html>
    </group>
  );
}

function WallPoster({ position, rotation, title, subtitle, bgColor = "#3498db" }) {
  return (
    <group position={position} rotation={rotation}>
      {/* 海報框 */}
      <mesh castShadow>
        <boxGeometry args={[1.3, 1.7, 0.015]} />
        <meshStandardMaterial color="#2c3e50" roughness={0.6} />
      </mesh>
      {/* 紙張 */}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[1.2, 1.6]} />
        <meshStandardMaterial color={bgColor} roughness={0.8} />
      </mesh>
      <Html position={[0, 0, 0.015]} transform center distanceFactor={5}>
        <div style={{
          width: '100px',
          height: '130px',
          background: bgColor,
          color: '#ffffff',
          fontFamily: 'monospace',
          padding: '8px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          userSelect: 'none',
          border: '1px solid rgba(255,255,255,0.2)'
        }}>
          <div style={{ fontWeight: 'bold', fontSize: '9px', borderBottom: '1px solid white', paddingBottom: '1px', textTransform: 'uppercase' }}>
            {title}
          </div>
          <div style={{ fontSize: '7px', opacity: 0.8, wordBreak: 'break-all' }}>
            {subtitle}
          </div>
          <div style={{ fontSize: '8px', fontWeight: 'bold', textAlign: 'right', color: '#f1c40f' }}>
            DELTA-3D
          </div>
        </div>
      </Html>
    </group>
  );
}

function VendingMachine({ position, rotation }) {
  return (
    <group position={position} rotation={rotation}>
      {/* 自動販賣機主體 */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.1, 2.0, 0.7]} />
        <meshStandardMaterial color="#e74c3c" roughness={0.4} metalness={0.5} />
      </mesh>
      {/* 玻璃櫥窗 */}
      <mesh position={[0, 0.35, 0.36]} castShadow>
        <boxGeometry args={[0.9, 0.8, 0.05]} />
        <meshStandardMaterial color="#2d3436" roughness={0.2} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0.35, 0.39]}>
        <planeGeometry args={[0.8, 0.7]} />
        <meshBasicMaterial color="#ffffff" opacity={0.15} transparent />
      </mesh>
      {/* 取物槽 */}
      <mesh position={[0, -0.65, 0.36]} castShadow>
        <boxGeometry args={[0.7, 0.25, 0.05]} />
        <meshStandardMaterial color="#1e272e" roughness={0.8} />
      </mesh>
    </group>
  );
}

function TrashCan({ position, rotation = [0, 0, 0] }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[0.25, 0.25, 0.8, 10]} />
      <meshStandardMaterial color="#95a5a6" roughness={0.4} metalness={0.8} />
    </mesh>
  );
}

function FacilityAssets({ hideCenter, facilityZone = 8, enemies = [], facilityEvent = 'normal' }) {
  // 地鐵長廊有 15 個日光燈，僅讓第 4 和 第 11 兩個日光燈投射陰影，其他日光燈關閉陰影投射，防止 WebGL 崩潰
  const lightZPositions = [-105, -90, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90, 105];

  const getWarpedProps = (origX, origY, origZ, origRotY = 0) => {
    const { position, rotation } = getWarpPosAndRot(origX, origY, origZ, origRotY, facilityEvent);
    return { position, rotation };
  };

  // 建立 15 級 3D 樓梯 (從 z = -120 到 z = -135，高度從 0 到 5.0)
  const steps = [];
  for (let i = 0; i < 15; i++) {
    const stepZ = -i * 1.0 - 0.5;
    const stepY = i * 0.33 + 0.165;
    const zGlobal = -120 + stepZ;
    const { position, rotation } = getWarpPosAndRot(0, stepY, zGlobal, 0, facilityEvent);
    steps.push(
      <mesh key={i} position={position} rotation={rotation} castShadow receiveShadow>
        <boxGeometry args={[8, 0.33, 1.0]} />
        <meshStandardMaterial color="#7f8c8d" roughness={0.7} />
      </mesh>
    );
  }

  const leftWallWarp = getWarpedProps(-4, 5.0, -127.5, Math.PI / 2);
  const rightWallWarp = getWarpedProps(4, 5.0, -127.5, -Math.PI / 2);
  const ceilingWarp = getWarpedProps(0, 10.0, -127.5, 0);
  const doorWallWarp = getWarpedProps(0, 7.5, -135, 0);
  const exitLightWarp = getWarpedProps(0, 8.5, -133, 0);

  return (
    <group>
      {/* 日光燈排燈 */}
      {lightZPositions.map((z, idx) => {
        const castShadow = idx === 3 || idx === 11;
        const warped = getWarpedProps(0, 4.9, z, 0);
        return (
          <SubwayFluorescentLight 
            key={idx} 
            position={warped.position} 
            rotation={warped.rotation}
            castShadow={castShadow} 
            facilityEvent={facilityEvent} 
          />
        );
      })}

      {/* 出口指示牌 (動態顯示號碼) */}
      <ExitSign {...getWarpedProps(0, 4.3, 0, 0)} number={facilityZone} />

      {/* 3D 樓梯及通道 enclosure */}
      {steps}
      
      {/* 樓梯通道圍封 (左右牆面、頂部封板與出口門壁) */}
      <group>
        {/* 左側壁 */}
        <mesh position={leftWallWarp.position} rotation={leftWallWarp.rotation} receiveShadow>
          <planeGeometry args={[15, 10]} />
          <meshStandardMaterial color="#ecf0f1" roughness={0.5} />
        </mesh>
        {/* 右側壁 */}
        <mesh position={rightWallWarp.position} rotation={rightWallWarp.rotation} receiveShadow>
          <planeGeometry args={[15, 10]} />
          <meshStandardMaterial color="#ecf0f1" roughness={0.5} />
        </mesh>
        {/* 樓梯頂部天花板 */}
        <group position={ceilingWarp.position} rotation={ceilingWarp.rotation}>
          <mesh rotation={[Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[8, 15]} />
            <meshStandardMaterial color="#bdc3c7" roughness={0.9} />
          </mesh>
        </group>
        {/* 樓梯頂部出口門壁 (封閉樓梯末端) */}
        <mesh position={doorWallWarp.position} rotation={doorWallWarp.rotation} castShadow receiveShadow>
          <boxGeometry args={[8, 5, 0.4]} />
          <meshStandardMaterial color="#2f3640" roughness={0.6} metalness={0.8} />
        </mesh>
        {/* 出口光源 (亮白光) */}
        <pointLight position={exitLightWarp.position} intensity={4.5} distance={15} color="#ffffff" />
      </group>

      {/* 牆上海報 */}
      <WallPoster {...getWarpedProps(-3.98, 2.5, -80, Math.PI / 2)} title="CLASSIFIED INTEL" subtitle="LEVEL 4 CLEARANCE REQUIRED. RESTRICTED SUBWAY DIVISION." bgColor="#2980b9" />
      <WallPoster {...getWarpedProps(3.98, 2.5, -40, -Math.PI / 2)} title="JOIN DELTA FORCE" subtitle="ENLIST TODAY TO DEFEND OUTPOST BASE SECURE SECTOR." bgColor="#27ae60" />
      <WallPoster {...getWarpedProps(-3.98, 2.5, -10, Math.PI / 2)} title="WANTED" subtitle="ELITE SHIELD TROOPS DETECTED IN SECTOR 8. EXTREME CAUTION." bgColor="#c0392b" />
      <WallPoster {...getWarpedProps(3.98, 2.5, 20, -Math.PI / 2)} title="TACTICAL GEAR" subtitle="EQUIP PRIMARY SILENCERS & EXTENDED MAGS FOR CLOSE CQB." bgColor="#8e44ad" />
      <WallPoster {...getWarpedProps(-3.98, 2.5, 50, Math.PI / 2)} title="WARNING" subtitle="HIGH VOLTAGE RAILWAY SECTIONS AHEAD. DO NOT CROSS." bgColor="#d35400" />
      <WallPoster {...getWarpedProps(3.98, 2.5, 80, -Math.PI / 2)} title="SECURE EXIT 8" subtitle="LZ EVACUATION ESTABLISHED AT THE CENTER ZONE (0,0)." bgColor="#16a085" />

      {/* 自動販賣機與垃圾桶組件 */}
      <VendingMachine {...getWarpedProps(-3.4, 1.0, -60, Math.PI / 2)} />
      <TrashCan {...getWarpedProps(-3.4, 0.4, -58, 0)} />

      <VendingMachine {...getWarpedProps(3.4, 1.0, -25, -Math.PI / 2)} />
      <TrashCan {...getWarpedProps(3.4, 0.4, -27, 0)} />

      <VendingMachine {...getWarpedProps(-3.4, 1.0, 30, Math.PI / 2)} />
      <TrashCan {...getWarpedProps(-3.4, 0.4, 32, 0)} />

      <VendingMachine {...getWarpedProps(3.4, 1.0, 70, -Math.PI / 2)} />
      <TrashCan {...getWarpedProps(3.4, 0.4, 68, 0)} />

      {/* 通道掩體箱 */}
      <MilitaryCrate {...getWarpedProps(-1.8, 0.6, -40, 0.3)} />
      <MilitaryCrate {...getWarpedProps(1.5, 0.6, -10, -0.2)} />
      <MilitaryCrate {...getWarpedProps(-1.2, 0.6, 15, 0.5)} />
      <MilitaryCrate {...getWarpedProps(1.6, 0.6, 45, -0.4)} scale={[1.1, 1.1, 1.1]} />
      <MilitaryCrate {...getWarpedProps(0, 0.6, -85, 0.1)} />
    </group>
  );
}

function TacticalAssets({ mapType, hideCenter, facilityZone, enemies, facilityEvent }) {
  if (mapType === 'facility') {
    return <FacilityAssets hideCenter={hideCenter} facilityZone={facilityZone} enemies={enemies} facilityEvent={facilityEvent} />;
  }
  return <OutpostAssets />;
}

// ==========================================
// 4. 第一人稱突擊步槍組件 (採用中空反射式紅點瞄準鏡，完全防遮擋)
// ==========================================
function Weapon({ gunRef, muzzleFlashRef, isAds, isLocked, activeWeapon, activeWeaponId, isHealing, isMeleeing = false, meleeProgress, attachments, selectedMap, facilityEvent, flashlightRef, targetRef }) {
  const medkitRef = useRef();
  const medkitLerp = useRef(0);
  const knifeRef = useRef();
  const knifeLerp = useRef(0);

  useFrame((state, delta) => {
    const safeDelta = Math.min(delta, 0.1);
    medkitLerp.current = THREE.MathUtils.lerp(medkitLerp.current, isHealing ? 1.0 : 0.0, 10.0 * safeDelta);
    knifeLerp.current = THREE.MathUtils.lerp(knifeLerp.current, isMeleeing ? 1.0 : 0.0, 15.0 * safeDelta);
    
    if (medkitRef.current) {
      const time = state.clock.getElapsedTime();
      const bobY = Math.sin(time * 5.0) * 0.02 * medkitLerp.current;
      const bobRotZ = Math.cos(time * 3.0) * 0.03 * medkitLerp.current;
      
      medkitRef.current.position.x = 0.05;
      medkitRef.current.position.y = THREE.MathUtils.lerp(-1.2, -0.28, medkitLerp.current) + bobY;
      medkitRef.current.position.z = THREE.MathUtils.lerp(-0.2, -0.65, medkitLerp.current);
      medkitRef.current.rotation.x = THREE.MathUtils.lerp(0.8, 0.25, medkitLerp.current);
      medkitRef.current.rotation.y = THREE.MathUtils.lerp(-0.5, 0.1, medkitLerp.current);
      medkitRef.current.rotation.z = bobRotZ;
      medkitRef.current.visible = medkitLerp.current > 0.01;
    }

    if (knifeRef.current) {
      const p = meleeProgress ? meleeProgress.current : 0;
      // 近戰軍刀弧形揮舞軌跡：由右下向左上/前快速斜切
      const swingX = Math.sin(p * Math.PI) * 0.45;
      const swingY = -Math.cos(p * Math.PI) * 0.25;
      const swingRotZ = Math.sin(p * Math.PI) * -1.8;
      
      knifeRef.current.position.x = THREE.MathUtils.lerp(0.5, 0.1, knifeLerp.current) - swingX;
      knifeRef.current.position.y = THREE.MathUtils.lerp(-1.0, -0.22, knifeLerp.current) + swingY;
      knifeRef.current.position.z = THREE.MathUtils.lerp(-0.2, -0.42, knifeLerp.current);
      
      knifeRef.current.rotation.x = THREE.MathUtils.lerp(0.8, -0.1, knifeLerp.current);
      knifeRef.current.rotation.y = THREE.MathUtils.lerp(-0.4, 0.4, knifeLerp.current);
      knifeRef.current.rotation.z = THREE.MathUtils.lerp(0.2, 0, knifeLerp.current) + swingRotZ;
      knifeRef.current.visible = knifeLerp.current > 0.01;
    }
  });

  return (
    <group ref={gunRef} name="weapon">
      {/* 槍支本體群組，補血時往下滑出螢幕，狙擊開鏡時隱藏 */}
      <group 
        rotation={[0, Math.PI, 0]} 
        scale={[0.13, 0.13, 0.13]} 
        position={[0, -1.5 * Math.max(medkitLerp.current, knifeLerp.current), 0]}
        visible={!(activeWeaponId === 'awp' && isAds)}
      >
        
        {/* 槍口閃光 (Muzzle Flash) - 共用以維持 ref 綁定與光源定位 */}
        <mesh 
          ref={muzzleFlashRef} 
          position={
            activeWeaponId === 'awp' ? [0, 0.02, 3.8] :
            activeWeaponId === 'ak47' ? [0, -0.04, 3.0] :
            activeWeaponId === 'mp5' ? [0, -0.04, 2.1] :
            activeWeaponId === 'm870' ? [0, 0.06, 2.8] :
            activeWeaponId === 'deagle' ? [0, 0.24, 1.1] :
            activeWeaponId === 'm9' ? [0, 0.20, 1.0] :
            [0, -0.04, 2.9] // default m4a1
          } 
          visible={false}
        >
          <sphereGeometry args={[
            (activeWeaponId === 'm9' || activeWeaponId === 'deagle') ? 0.15 : 0.25, 8, 8
          ]} />
          <meshBasicMaterial color="#ffaa00" transparent opacity={0.9} />
          <pointLight color="#ffaa00" intensity={4} distance={6} />
        </mesh>

        {activeWeaponId === 'm4a1' && (
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
            
            {/* 10. 中空瞄準鏡筒 */}
            <mesh position={[0, 0.58, 0.15]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.32, 0.32, 0.18, 32, 1, true]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.4} metalness={0.8} side={THREE.DoubleSide} />
            </mesh>

            {/* 11. 3D 紅點瞄準線 */}
            {isAds && (
              <group position={[0, 0.58, 0.15]}>
                <mesh>
                  <circleGeometry args={[0.007, 16]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.9} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0, 0.001]}>
                  <ringGeometry args={[0.024, 0.028, 24]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.75} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
              </group>
            )}
          </>
        )}

        {activeWeaponId === 'ak47' && (
          <>
            {/* 1. 機匣/槍身本體 (Receiver) */}
            <mesh castShadow>
              <boxGeometry args={[0.26, 0.46, 2.0]} />
              <meshStandardMaterial color="#222222" roughness={0.7} metalness={0.8} />
            </mesh>
            
            {/* 2. 木質槍托 (Stock) */}
            <mesh position={[0, -0.05, -1.35]} rotation={[-0.05, 0, 0]} castShadow>
              <boxGeometry args={[0.2, 0.38, 1.1]} />
              <meshStandardMaterial color="#8a4726" roughness={0.9} />
            </mesh>
            
            {/* 3. 木質護木 (Handguard) */}
            <mesh position={[0, -0.04, 1.3]} castShadow>
              <boxGeometry args={[0.24, 0.28, 1.0]} />
              <meshStandardMaterial color="#8a4726" roughness={0.9} />
            </mesh>
            
            {/* 4. 上方導氣管 (Gas Tube) */}
            <mesh position={[0, 0.16, 1.25]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.04, 0.04, 0.9]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.6} metalness={0.8} />
            </mesh>
            
            {/* 5. 槍管 (Barrel) */}
            <mesh position={[0, -0.04, 2.3]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.03, 0.03, 1.0]} />
              <meshStandardMaterial color="#111" roughness={0.5} />
            </mesh>
            
            {/* 6. 準星 (Front Sight) */}
            <mesh position={[0, 0.18, 2.8]} castShadow>
              <boxGeometry args={[0.04, 0.16, 0.08]} />
              <meshStandardMaterial color="#111" />
            </mesh>
            
            {/* 7. 弧形香蕉彈匣 (Magazine) */}
            <mesh position={[0, -0.5, 0.45]} rotation={[0.35, 0, 0]} castShadow>
              <boxGeometry args={[0.12, 0.8, 0.4]} />
              <meshStandardMaterial color="#202020" roughness={0.85} />
            </mesh>
            
            {/* 8. 木質握把 (Grip) */}
            <mesh position={[0, -0.38, -0.4]} rotation={[-0.38, 0, 0]} castShadow>
              <boxGeometry args={[0.15, 0.48, 0.24]} />
              <meshStandardMaterial color="#8a4726" roughness={0.9} />
            </mesh>
            
            {/* 9. 瞄準鏡支架 & 紅點鏡筒 */}
            <mesh position={[0, 0.42, 0.15]} castShadow>
              <boxGeometry args={[0.2, 0.18, 0.5]} />
              <meshStandardMaterial color="#222222" />
            </mesh>
            <mesh position={[0, 0.58, 0.15]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.32, 0.32, 0.18, 32, 1, true]} />
              <meshStandardMaterial color="#222222" roughness={0.4} metalness={0.8} side={THREE.DoubleSide} />
            </mesh>

            {/* 紅點瞄準線 */}
            {isAds && (
              <group position={[0, 0.58, 0.15]}>
                <mesh>
                  <circleGeometry args={[0.007, 16]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.9} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0, 0.001]}>
                  <ringGeometry args={[0.024, 0.028, 24]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.75} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
              </group>
            )}
          </>
        )}

        {activeWeaponId === 'awp' && (
          <>
            {/* 1. 一體化軍綠色主體槍身 (Body & Stock) */}
            <mesh position={[0, -0.05, 0.1]} castShadow>
              <boxGeometry args={[0.25, 0.45, 2.2]} />
              <meshStandardMaterial color="#3b4f3b" roughness={0.9} />
            </mesh>
            <mesh position={[0, 0.05, -1.45]} castShadow>
              <boxGeometry args={[0.22, 0.48, 1.3]} />
              <meshStandardMaterial color="#3b4f3b" roughness={0.9} />
            </mesh>
            
            {/* 2. 槍托臉頰貼板 */}
            <mesh position={[0, 0.34, -1.3]} castShadow>
              <boxGeometry args={[0.18, 0.12, 0.8]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
            </mesh>
            
            {/* 3. 超長重型鋼鐵槍管 (Heavy Barrel) */}
            <mesh position={[0, 0.02, 2.6]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.045, 0.035, 2.4]} />
              <meshStandardMaterial color="#111111" roughness={0.4} metalness={0.8} />
            </mesh>
            
            {/* 4. 雙室槍口制退器 (Muzzle Brake) */}
            <mesh position={[0, 0.02, 3.8]} castShadow>
              <boxGeometry args={[0.08, 0.08, 0.25]} />
              <meshStandardMaterial color="#111" roughness={0.4} metalness={0.8} />
            </mesh>
            
            {/* 5. 經典手拉機栓 (Bolt Handle) */}
            <mesh position={[0.16, 0.1, -0.3]} rotation={[0, 0, Math.PI / 3]} castShadow>
              <cylinderGeometry args={[0.02, 0.02, 0.2]} />
              <meshStandardMaterial color="#111" roughness={0.3} metalness={0.9} />
            </mesh>
            
            {/* 6. 短狙擊彈匣 (Short Magazine) */}
            <mesh position={[0, -0.36, 0.1]} castShadow>
              <boxGeometry args={[0.14, 0.35, 0.3]} />
              <meshStandardMaterial color="#1e1e1e" roughness={0.8} />
            </mesh>
            
            {/* 7. 大型高倍狙擊鏡 (Sniper Scope) */}
            <mesh position={[0, 0.34, -0.2]} castShadow>
              <boxGeometry args={[0.08, 0.2, 0.6]} />
              <meshStandardMaterial color="#1e1e1e" />
            </mesh>
            <mesh position={[0, 0.48, -0.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.14, 0.11, 1.2]} />
              <meshStandardMaterial color="#111111" roughness={0.4} metalness={0.8} />
            </mesh>
            <mesh position={[0, 0.48, 0.42]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.16, 0.14, 0.15]} />
              <meshStandardMaterial color="#1e1e1e" />
            </mesh>
          </>
        )}

        {activeWeaponId === 'mp5' && (
          <>
            {/* MP5 SMG Model */}
            {/* 1. 機匣與上機蓋 (Receiver) */}
            <mesh castShadow>
              <boxGeometry args={[0.24, 0.4, 1.4]} />
              <meshStandardMaterial color="#1c1c1c" roughness={0.7} metalness={0.75} />
            </mesh>
            
            {/* 2. 伸縮槍托桿 (Telescoping Rods) */}
            <mesh position={[-0.08, 0.05, -0.8]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.02, 0.02, 0.8]} />
              <meshStandardMaterial color="#101010" roughness={0.5} metalness={0.9} />
            </mesh>
            <mesh position={[0.08, 0.05, -0.8]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.02, 0.02, 0.8]} />
              <meshStandardMaterial color="#101010" roughness={0.5} metalness={0.9} />
            </mesh>
            <mesh position={[0, 0.05, -1.2]} castShadow>
              <boxGeometry args={[0.18, 0.45, 0.12]} />
              <meshStandardMaterial color="#151515" roughness={0.9} />
            </mesh>
            
            {/* 3. 戰術肋條塑料護木 (Handguard) */}
            <mesh position={[0, -0.04, 0.95]} castShadow>
              <boxGeometry args={[0.22, 0.28, 0.8]} />
              <meshStandardMaterial color="#151515" roughness={0.9} />
            </mesh>
            
            {/* 4. 短槍管 (Short Barrel) */}
            <mesh position={[0, -0.02, 1.55]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.028, 0.028, 0.5]} />
              <meshStandardMaterial color="#111" roughness={0.5} />
            </mesh>
            
            {/* 5. 圓環前準星 (Hooded Front Sight) */}
            <mesh position={[0, 0.15, 1.7]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.08, 0.08, 0.05, 16, 1, true]} />
              <meshStandardMaterial color="#101010" side={THREE.DoubleSide} />
            </mesh>
            
            {/* 6. 彎曲 9mm 彈匣 */}
            <mesh position={[0, -0.45, 0.4]} rotation={[0.18, 0, 0]} castShadow>
              <boxGeometry args={[0.1, 0.65, 0.18]} />
              <meshStandardMaterial color="#151515" roughness={0.8} />
            </mesh>
            
            {/* 7. 手槍握把 (Grip) */}
            <mesh position={[0, -0.35, -0.3]} rotation={[-0.4, 0, 0]} castShadow>
              <boxGeometry args={[0.14, 0.42, 0.2]} />
              <meshStandardMaterial color="#151515" roughness={0.9} />
            </mesh>
            
            {/* 8. 瞄準鏡 */}
            <mesh position={[0, 0.38, 0.15]} castShadow>
              <boxGeometry args={[0.16, 0.14, 0.4]} />
              <meshStandardMaterial color="#1a1a1a" />
            </mesh>
            <mesh position={[0, 0.52, 0.15]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.28, 0.28, 0.16, 32, 1, true]} />
              <meshStandardMaterial color="#151515" roughness={0.4} metalness={0.8} side={THREE.DoubleSide} />
            </mesh>

            {/* 紅點瞄準線 */}
            {isAds && (
              <group position={[0, 0.52, 0.15]}>
                <mesh>
                  <circleGeometry args={[0.007, 16]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.9} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0, 0.001]}>
                  <ringGeometry args={[0.024, 0.028, 24]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.75} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
              </group>
            )}
          </>
        )}

        {activeWeaponId === 'm870' && (
          <>
            {/* M870 Shotgun Model */}
            {/* 1. 金屬灰機匣 (Receiver) */}
            <mesh castShadow>
              <boxGeometry args={[0.25, 0.42, 1.8]} />
              <meshStandardMaterial color="#353535" roughness={0.65} metalness={0.7} />
            </mesh>
            
            {/* 2. 木質槍托 (Stock) */}
            <mesh position={[0, -0.06, -1.3]} rotation={[-0.1, 0, 0]} castShadow>
              <boxGeometry args={[0.2, 0.4, 1.2]} />
              <meshStandardMaterial color="#8a4726" roughness={0.95} />
            </mesh>
            
            {/* 3. 管狀下彈倉 (Magazine Tube) */}
            <mesh position={[0, -0.06, 1.3]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.038, 0.038, 1.3]} />
              <meshStandardMaterial color="#222" roughness={0.6} metalness={0.8} />
            </mesh>
            
            {/* 4. 木質滑動泵把 (Pump Handle / Slider) */}
            <mesh position={[0, -0.06, 0.9]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.06, 0.06, 0.7]} />
              <meshStandardMaterial color="#8a4726" roughness={0.9} />
            </mesh>
            
            {/* 5. 鋼鐵單槍管 (Shotgun Barrel) */}
            <mesh position={[0, 0.06, 1.5]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.045, 0.045, 1.6]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.4} metalness={0.8} />
            </mesh>
            
            {/* 6. 機械瞄具 (Sight) */}
            <mesh position={[0, 0.36, 0.15]} castShadow>
              <boxGeometry args={[0.16, 0.12, 0.4]} />
              <meshStandardMaterial color="#222" />
            </mesh>
            <mesh position={[0, 0.48, 0.15]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.26, 0.26, 0.16, 32, 1, true]} />
              <meshStandardMaterial color="#222" roughness={0.4} metalness={0.8} side={THREE.DoubleSide} />
            </mesh>

            {/* 紅點瞄準線 */}
            {isAds && (
              <group position={[0, 0.48, 0.15]}>
                <mesh>
                  <circleGeometry args={[0.007, 16]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.9} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0, 0.001]}>
                  <ringGeometry args={[0.024, 0.028, 24]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.75} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
              </group>
            )}
          </>
        )}

        {activeWeaponId === 'm9' && (
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
              <group position={[0, 0.45, 0.1]}>
                <mesh>
                  <circleGeometry args={[0.007, 16]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.9} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0, 0.001]}>
                  <ringGeometry args={[0.024, 0.028, 24]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.75} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
              </group>
            )}
          </>
        )}

        {activeWeaponId === 'deagle' && (
          <>
            {/* Desert Eagle (Deagle) Model */}
            {/* 1. 巨大魁梧拋光銀色滑套 (Slide) - 頂部金屬 */}
            <mesh position={[0, 0.24, 0.35]} castShadow>
              <boxGeometry args={[0.22, 0.28, 1.2]} />
              <meshStandardMaterial color="#dddddd" roughness={0.15} metalness={0.9} />
            </mesh>
            
            {/* 2. 拋光銀色槍身底座 (Frame) */}
            <mesh position={[0, 0.06, 0.40]} castShadow>
              <boxGeometry args={[0.2, 0.18, 0.8]} />
              <meshStandardMaterial color="#dddddd" roughness={0.15} metalness={0.9} />
            </mesh>
            
            {/* 3. 大口徑槍管 (Barrel) */}
            <mesh position={[0, 0.25, 0.95]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.05, 0.05, 0.3]} />
              <meshStandardMaterial color="#111111" roughness={0.2} metalness={0.9} />
            </mesh>
            
            {/* 4. 巨大黑色橡膠握把 (Black Grip) */}
            <mesh position={[0, -0.24, 0.1]} rotation={[-0.18, 0, 0]} castShadow>
              <boxGeometry args={[0.18, 0.52, 0.26]} />
              <meshStandardMaterial color="#151515" roughness={0.95} />
            </mesh>
            
            {/* 5. 扳機護圈 (Trigger Guard) */}
            <mesh position={[0, -0.08, 0.48]} castShadow>
              <boxGeometry args={[0.08, 0.14, 0.18]} />
              <meshStandardMaterial color="#dddddd" roughness={0.2} metalness={0.9} />
            </mesh>
            
            {/* 6. 瞄準鏡架 & 鏡框 */}
            <mesh position={[0, 0.41, 0.1]} castShadow>
              <boxGeometry args={[0.16, 0.08, 0.26]} />
              <meshStandardMaterial color="#151515" roughness={0.7} />
            </mesh>
            <mesh position={[0, 0.53, 0.1]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.18, 0.18, 0.14, 16, 1, true]} />
              <meshStandardMaterial color="#1c1c1c" roughness={0.4} metalness={0.7} side={THREE.DoubleSide} />
            </mesh>
            
            {/* 7. 3D 紅點瞄準線 (開鏡時顯示) */}
            {isAds && (
              <group position={[0, 0.53, 0.1]}>
                <mesh>
                  <circleGeometry args={[0.007, 16]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.9} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0, 0.001]}>
                  <ringGeometry args={[0.024, 0.028, 24]} />
                  <meshBasicMaterial color="#ff1111" transparent opacity={0.75} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
              </group>
            )}
          </>
        )}
      </group>

      {selectedMap === 'facility' && facilityEvent === 'blackout' && (
        <>
          <spotLight
            ref={flashlightRef}
            angle={0.4}
            penumbra={0.6}
            intensity={12.0}
            distance={50}
            castShadow
            color="#ffffff"
            shadow-mapSize-width={512}
            shadow-mapSize-height={512}
          />
          <mesh ref={targetRef} position={[0, 0, 0]} visible={false}>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
          </mesh>
        </>
      )}

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

      {/* 獨立的 3D 軍刀模型，只有在 isMeleeing 時顯示，並由 useFrame 動態控制 */}
      <group ref={knifeRef} scale={[0.8, 0.8, 0.8]} visible={false}>
        {/* 刀柄 Handle */}
        <mesh castShadow>
          <boxGeometry args={[0.03, 0.14, 0.03]} />
          <meshStandardMaterial color="#18181c" roughness={0.8} />
        </mesh>
        {/* 護手 Guard */}
        <mesh position={[0, 0.07, 0]} castShadow>
          <boxGeometry args={[0.08, 0.012, 0.03]} />
          <meshStandardMaterial color="#4a4d50" metalness={0.85} roughness={0.2} />
        </mesh>
        {/* 刀刃 Blade */}
        <mesh position={[0, 0.20, 0]} castShadow>
          <boxGeometry args={[0.036, 0.26, 0.008]} />
          <meshStandardMaterial color="#b1b5b9" metalness={0.9} roughness={0.15} />
        </mesh>
        {/* 刀背鋸齒與細部 */}
        <mesh position={[0.018, 0.20, 0]}>
          <boxGeometry args={[0.004, 0.26, 0.006]} />
          <meshStandardMaterial color="#8b8e91" metalness={0.9} />
        </mesh>
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
function Grenade({ position, velocity, onExplode, type = 'grenade' }) {
  const meshRef = useRef();
  const vel = useRef(velocity.clone());
  const timer = useRef(2.5); // 2.5 秒定時引信
  const [ledColor, setLedColor] = useState('#ff0000');

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const pos = meshRef.current.position;

    timer.current -= delta;
    if (timer.current <= 0) {
      onExplode(pos.clone(), type);
      return;
    }

    // 紅色 LED 警示快閃 (僅 HE 手榴彈)
    if (type === 'grenade') {
      const flashIndex = Math.floor(state.clock.getElapsedTime() * 12) % 2;
      setLedColor(flashIndex === 0 ? '#ff0000' : '#1a0000');
    }

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
      {type === 'grenade' && (
        <>
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
        </>
      )}

      {type === 'flashbang' && (
        <>
          {/* 閃光彈銀色圓柱體 */}
          <mesh castShadow>
            <cylinderGeometry args={[0.04, 0.04, 0.18, 8]} />
            <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.1} />
          </mesh>
          {/* 藍色條紋環 */}
          <mesh position={[0, 0.03, 0]}>
            <cylinderGeometry args={[0.041, 0.041, 0.03, 8]} />
            <meshBasicMaterial color="#0055ff" />
          </mesh>
          {/* 金屬頂蓋/拉環 */}
          <mesh position={[0, 0.1, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.02, 6]} />
            <meshStandardMaterial color="#4f4f4f" metalness={0.7} />
          </mesh>
        </>
      )}

      {type === 'smoke' && (
        <>
          {/* 煙霧彈灰色圓柱體 */}
          <mesh castShadow>
            <cylinderGeometry args={[0.05, 0.05, 0.20, 8]} />
            <meshStandardMaterial color="#7f8c8d" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* 黃色條紋環 */}
          <mesh position={[0, 0.04, 0]}>
            <cylinderGeometry args={[0.051, 0.051, 0.03, 8]} />
            <meshBasicMaterial color="#f1c40f" />
          </mesh>
          {/* 金屬頂蓋/拉環 */}
          <mesh position={[0, 0.11, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.02, 6]} />
            <meshStandardMaterial color="#4f4f4f" metalness={0.7} />
          </mesh>
        </>
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
  flashbangs,
  setFlashbangs,
  smokes,
  setSmokes,
  activeThrowable,
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
  cameraRef,
  primaryWeaponId,
  secondaryWeaponId,
  nearContainer,
  setNearContainer,
  isLooting,
  setIsLooting,
  lootProgress,
  setLootProgress,
  lootedContainers,
  startLooting,
  stopLooting,
  extractionActive,
  extractionState,
  setExtractionCountdown,
  setIsPlayerInExtractionZone,
  onExtractSuccess,
  primaryConfig,
  secondaryConfig,
  selectedMap,
  lootContainers,
  facilityZone,
  onAdvanceFacilityZone,
  adminTeleportTrigger,
  facilityEvent,
  flashlightRef,
  targetRef,
}) {
  const { camera, scene } = useThree();
  const keys = useKeyboard();

  const facilityZoneRef = useRef(facilityZone);
  useEffect(() => {
    facilityZoneRef.current = facilityZone;
  }, [facilityZone]);

  const transitionInProgressRef = useRef(false);
  useEffect(() => {
    transitionInProgressRef.current = false;
  }, [facilityZone, resetTrigger]);

  useEffect(() => {
    if (adminTeleportTrigger > 0 && selectedMap === 'facility') {
      camera.position.set(0, 1.6, -108);
    }
  }, [adminTeleportTrigger, camera, selectedMap]);

  useEffect(() => {
    if (cameraRef) {
      cameraRef.current = camera;
    }
  }, [camera, cameraRef]);
  
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
  const primaryWeaponIdRef = useRef(primaryWeaponId);
  const secondaryWeaponIdRef = useRef(secondaryWeaponId);
  const primaryConfigRef = useRef(primaryConfig);
  const secondaryConfigRef = useRef(secondaryConfig);
 
  const isTutorialRef = useRef(isTutorial);
  const onTriggerTutorialRef = useRef(onTriggerTutorial);
 
  const setAmmoRef = useRef(setAmmo);
  const enemiesRef = useRef(enemies);
  const onHitEnemyRef = useRef(onHitEnemy);
  const addImpactEffectRef = useRef(addImpactEffect);
  const addCasingRef = useRef(addCasing);

  const prevNearContainer = useRef(null);
  const isLootingRef = useRef(isLooting);
  const nearContainerRef = useRef(nearContainer);
  const isAdsRef = useRef(isAds);
  const lootedContainersRef = useRef(lootedContainers);

  useEffect(() => {
    primaryConfigRef.current = primaryConfig;
  }, [primaryConfig]);

  useEffect(() => {
    secondaryConfigRef.current = secondaryConfig;
  }, [secondaryConfig]);

  useEffect(() => {
    isLootingRef.current = isLooting;
  }, [isLooting]);

  useEffect(() => {
    isAdsRef.current = isAds;
  }, [isAds]);

  useEffect(() => {
    lootedContainersRef.current = lootedContainers;
  }, [lootedContainers]);

  useEffect(() => {
    nearContainerRef.current = nearContainer;
  }, [nearContainer]);

  const extractionActiveRef = useRef(extractionActive);
  const extractionStateRef = useRef(extractionState);
  const extractionCountdownRef = useRef(5.0);
  const onExtractSuccessRef = useRef(onExtractSuccess);

  useEffect(() => {
    extractionActiveRef.current = extractionActive;
  }, [extractionActive]);

  useEffect(() => {
    extractionStateRef.current = extractionState;
  }, [extractionState]);

  useEffect(() => {
    onExtractSuccessRef.current = onExtractSuccess;
  }, [onExtractSuccess]);

  useEffect(() => {
    if (!extractionActive) {
      extractionCountdownRef.current = 5.0;
    }
  }, [extractionActive]);
 
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
    primaryWeaponIdRef.current = primaryWeaponId;
  }, [primaryWeaponId]);

  useEffect(() => {
    secondaryWeaponIdRef.current = secondaryWeaponId;
  }, [secondaryWeaponId]);
 
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
      const weaponConfig = activeWeaponRef.current === 'primary' 
        ? primaryConfigRef.current 
        : secondaryConfigRef.current;
      const fireInterval = (weaponConfig?.fireInterval || 100) / 1000;
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

      const sensitivity = 0.007;
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

  const handleThrowThrowable = () => {
    let hasQuantity = false;
    if (activeThrowable === 'grenade' && grenades > 0) {
      setGrenades((prev) => prev - 1);
      hasQuantity = true;
    } else if (activeThrowable === 'flashbang' && flashbangs > 0) {
      setFlashbangs((prev) => prev - 1);
      hasQuantity = true;
    } else if (activeThrowable === 'smoke' && smokes > 0) {
      setSmokes((prev) => prev - 1);
      hasQuantity = true;
    }

    if (hasQuantity) {
      const pos = camera.position.clone();
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      
      const startPos = pos.clone().add(dir.clone().multiplyScalar(0.4));
      const velocity = dir.clone().multiplyScalar(13.0);
      velocity.y += 4.5;
      
      addGrenade(startPos, velocity, activeThrowable);

      if (isTutorialRef.current) {
        onTriggerTutorialRef.current('grenade');
      }
    }
  };

  // 監聽 G 鍵拋擲手榴彈
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyG' && gameStateRef.current === 'active' && (device === 'mobile' || document.pointerLockElement)) {
        handleThrowThrowable();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [grenades, flashbangs, smokes, activeThrowable, camera]);

  // 監聽行動端按鈕拋擲手榴彈
  useEffect(() => {
    if (mobileGrenadeTrigger > 0 && gameStateRef.current === 'active') {
      handleThrowThrowable();
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

  // 監聽 F 鍵進行物資箱長按搜刮 Hold-to-Search (KeyDown 開始，KeyUp 終止)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyF' && gameStateRef.current === 'active' && (device === 'mobile' || document.pointerLockElement)) {
        if (prevNearContainer.current) {
          startLooting();
        }
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'KeyF') {
        stopLooting();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [device, startLooting, stopLooting]);

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

    const activeWeaponId = activeWeaponRef.current === 'primary' 
      ? primaryWeaponIdRef.current 
      : secondaryWeaponIdRef.current;
    const weaponConfig = activeWeaponRef.current === 'primary' 
      ? primaryConfigRef.current 
      : secondaryConfigRef.current;

    if (runStatsRef && runStatsRef.current) {
      runStatsRef.current.shotsFired += 1;
    }

    // 播放合成槍聲
    if (weaponConfig?.isPrimary) {
      soundManager.playGunshot(weaponConfig?.silence);
    } else {
      soundManager.playPistolGunshot(weaponConfig?.silence);
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

    recoilOffset.current = weaponConfig.recoil;

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
    } else if (keysState.run && isMoving && !isAdsRef.current) {
      currentSpread = 0.06;
    } else if (isMoving) {
      currentSpread = 0.035;
    }

    const pelletCount = activeWeaponId === 'm870' ? 8 : 1;

    for (let p = 0; p < pelletCount; p++) {
      let finalSpread = THREE.MathUtils.lerp(currentSpread, 0.001, adsLerp.current);
      if (activeWeaponId === 'm870') {
        finalSpread = THREE.MathUtils.lerp(0.065, 0.024, adsLerp.current);
      }
      finalSpread *= (weaponConfig?.spreadFactor || 1);

      const spreadX = (Math.random() - 0.5) * finalSpread;
      const spreadY = (Math.random() - 0.5) * finalSpread;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(spreadX, spreadY), camera);
      const intersects = raycaster.intersectObjects(scene.children, true);

      if (intersects.length > 0) {
        let hit = null;
        for (let i = 0; i < intersects.length; i++) {
          let obj = intersects[i].object;
          
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
            if (enemyObj && enemyObj.isAlly) {
              if (activeWeaponId !== 'm870' || p < 2) {
                addImpactEffectRef.current(hit.point, hit.face.normal);
              }
            } else {
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
              onHitEnemyRef.current(enemyId, hit.point, isHeadshot, parent);
            }
          } else {
            // M870 散彈槍只生成部分彈孔，防止大量物理微粒導致畫面卡頓
            if (activeWeaponId !== 'm870' || p < 2) {
              addImpactEffectRef.current(hit.point, hit.face.normal);
            }
          }
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
      const weaponConfig = activeWeaponRef.current === 'primary' 
        ? primaryConfigRef.current 
        : secondaryConfigRef.current;
      const fireInterval = (weaponConfig?.fireInterval || 100) / 1000;
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
    // 6.X 雷達小地圖實時更新 (Radar Minimap)
    // ------------------------------------------
    const radarDots = document.getElementById('radar-dots');
    if (radarDots && gameStateRef.current === 'active') {
      let dotsHtml = '';
      
      const playerPos = state.camera.position;
      
      const fwd = new THREE.Vector3();
      state.camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      
      const maxRadarDist = 120; // 顯示範圍：120公尺
      const scale = 60 / maxRadarDist; // 雷達半徑對應 60px

      state.scene.traverse((obj) => {
        if (obj.userData && obj.userData.isEnemy && !obj.userData.isDying) {
          const enemyPos = new THREE.Vector3();
          obj.getWorldPosition(enemyPos);
          const diff = new THREE.Vector3().subVectors(enemyPos, playerPos);
          diff.y = 0;

          const localX = diff.dot(right);
          const localY = diff.dot(fwd);

          const dist = Math.sqrt(localX * localX + localY * localY);
          if (dist < maxRadarDist) {
            const left = 60 + localX * scale;
            const top = 60 - localY * scale;

            let dotColor = '#ff3333';
            if (obj.userData.enemyType === ENEMY_TYPES.SHIELD) {
              dotColor = '#00ff66';
            } else if (obj.userData.enemyType === ENEMY_TYPES.GRENADIER) {
              dotColor = '#ffa500';
            } else if (obj.userData.enemyType === ENEMY_TYPES.SNIPER) {
              dotColor = '#0088ff';
            }

            dotsHtml += `<div class="radar-dot enemy-dot" style="left: ${left}px; top: ${top}px; background-color: ${dotColor};"></div>`;
          }
        }
      });

      if (extractionActiveRef.current) {
        const diff = new THREE.Vector3(0, 0, 0).sub(playerPos);
        diff.y = 0;
        
        const localX = diff.dot(right);
        const localY = diff.dot(fwd);
        
        const dist = Math.sqrt(localX * localX + localY * localY);
        if (dist < maxRadarDist) {
          const left = 60 + localX * scale;
          const top = 60 - localY * scale;
          dotsHtml += `<div class="radar-dot lz-dot" style="left: ${left}px; top: ${top}px;">H</div>`;
        }
      }

      radarDots.innerHTML = dotsHtml;
    }

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
    // 6.X 物資箱鄰近狀態與距離檢測
    // ------------------------------------------
    const playerPos3D = camera.position.clone();
    let closestCrate = null;
    let minCrateDist = Infinity;

    lootContainers.forEach((container) => {
      if (lootedContainersRef.current && lootedContainersRef.current[container.id]) return;
      const dist = playerPos3D.distanceTo(container.position);
      if (dist < minCrateDist) {
        minCrateDist = dist;
        closestCrate = container;
      }
    });

    let currentNearCrate = null;
    if (minCrateDist < 3.0 && closestCrate) {
      currentNearCrate = closestCrate;
    }

    if (currentNearCrate !== prevNearContainer.current) {
      prevNearContainer.current = currentNearCrate;
      setNearContainer(currentNearCrate);
    }

    // 如果正在搜刮但玩家走遠了，自動中斷
    if (isLootingRef.current && !currentNearCrate) {
      stopLooting();
    }

    // ------------------------------------------
    // 6.X 受到傷害後的環形方向指示器實時更新
    // ------------------------------------------
    const damageArrows = document.querySelectorAll('.damage-indicator-arrow');
    if (damageArrows.length > 0) {
      damageArrows.forEach((el) => {
        const xStr = el.getAttribute('data-x');
        const zStr = el.getAttribute('data-z');
        if (xStr && zStr) {
          const ax = parseFloat(xStr);
          const az = parseFloat(zStr);
          
          const fwd = new THREE.Vector3();
          state.camera.getWorldDirection(fwd);
          fwd.y = 0;
          fwd.normalize();
          
          const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
          
          const playerPos = state.camera.position.clone();
          playerPos.y = 0;
          
          const toAttacker = new THREE.Vector3(ax, 0, az).sub(playerPos);
          toAttacker.y = 0;
          toAttacker.normalize();
          
          const fwdDot = toAttacker.dot(fwd);
          const rightDot = toAttacker.dot(right);
          
          const relativeAngle = Math.atan2(rightDot, fwdDot);
          const angleDeg = (relativeAngle * 180) / Math.PI;
          
          el.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg) translateY(-100px)`;
        }
      });
    }

    // ------------------------------------------
    // 6.X 8號出口通關進度/樓梯撤離判定
    // ------------------------------------------
    if (gameStateRef.current === 'active' && selectedMap === 'facility') {
      const aliveCount = enemies.filter(e => e.state === 'alive' && !e.isAlly).length;
      if (aliveCount === 0) {
        if (facilityZoneRef.current > 1) {
          if (camera.position.z <= -110 && !transitionInProgressRef.current) {
            transitionInProgressRef.current = true;
            if (onAdvanceFacilityZone) onAdvanceFacilityZone();
          }
        } else {
          // 出口 1 肅清後走樓梯撤離
          if (camera.position.z <= -132) {
            if (onExtractSuccessRef.current) {
              onExtractSuccessRef.current();
            }
          }
        }
      }
    }

    // ------------------------------------------
    // 6.X 直升機撤離 LZ 範圍與倒數計時判定
    // ------------------------------------------
    if (extractionActiveRef.current && extractionStateRef.current === 'landed') {
      const distToLZ = Math.sqrt(state.camera.position.x * state.camera.position.x + state.camera.position.z * state.camera.position.z);
      if (distToLZ < 6.0) {
        setIsPlayerInExtractionZone(true);
        extractionCountdownRef.current = Math.max(0, extractionCountdownRef.current - safeDelta);
        setExtractionCountdown(Math.max(0, Math.ceil(extractionCountdownRef.current * 10) / 10));
        
        if (extractionCountdownRef.current <= 0) {
          if (onExtractSuccessRef.current) {
            onExtractSuccessRef.current();
          }
        }
      } else {
        setIsPlayerInExtractionZone(false);
        if (extractionCountdownRef.current !== 5.0) {
          extractionCountdownRef.current = 5.0;
          setExtractionCountdown(5.0);
        }
      }
    } else {
      setIsPlayerInExtractionZone(false);
      if (extractionCountdownRef.current !== 5.0) {
        extractionCountdownRef.current = 5.0;
        setExtractionCountdown(5.0);
      }
    }

    // ------------------------------------------
    // 連發射擊邏輯 (全自動模式下按住滑鼠)
    // ------------------------------------------
    if (fireModeRef.current === 'auto' && isMouseDown.current) {
      const now = performance.now() / 1000;
      const weaponConfig = activeWeaponRef.current === 'primary' 
        ? primaryConfigRef.current 
        : secondaryConfigRef.current;
      const fireInterval = (weaponConfig?.fireInterval || 100) / 1000;
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
    const activeWeaponId = activeWeaponRef.current === 'primary' 
      ? primaryWeaponIdRef.current 
      : secondaryWeaponIdRef.current;
    const weaponConfig = activeWeaponRef.current === 'primary' 
      ? primaryConfigRef.current 
      : secondaryConfigRef.current;

    const adsSpeed = 0.16 * (weaponConfig?.adsSpeedFactor || 1);
    adsLerp.current = THREE.MathUtils.lerp(adsLerp.current, isAdsRef.current ? 1 : 0, adsSpeed);
    
    const targetFov = weaponConfig?.zoomFov || (activeWeaponId === 'awp' ? 18 : 45);
    camera.fov = THREE.MathUtils.lerp(70, targetFov, adsLerp.current);
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
    let activeColliders = selectedMap === 'facility' ? [...FACILITY_COLLIDERS] : [...STATIC_COLLIDERS];
    if (selectedMap === 'facility' && facilityEvent === 'warp') {
      activeColliders = activeColliders.map(c => {
        const z = c.z;
        const x_c = Math.sin(z * 0.04) * 6.0;
        const rotY = Math.atan(0.24 * Math.cos(z * 0.04));
        const newX = x_c + c.x * Math.cos(rotY);
        const newZ = z - c.x * Math.sin(rotY);
        return { ...c, x: newX, z: newZ };
      });
    }
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
    
    if (selectedMap === 'facility') {
      if (facilityEvent === 'warp') {
        const xOffset = Math.sin(camera.position.z * 0.04) * 6.0;
        camera.position.x = Math.max(xOffset - 3.6, Math.min(xOffset + 3.6, camera.position.x));
      } else {
        camera.position.x = Math.max(-3.6, Math.min(3.6, camera.position.x));
      }
    } else {
      camera.position.x = Math.max(-mapLimit, Math.min(mapLimit, camera.position.x));
    }

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
    
    if (selectedMap === 'facility') {
      const aliveCount = enemies.filter(e => e.state === 'alive' && !e.isAlly).length;
      const isExitOpen = facilityZoneRef.current === 1 && aliveCount === 0;
      const minZ = isExitOpen ? -135 : -115;
      camera.position.z = Math.max(minZ, Math.min(115, camera.position.z));
    } else {
      camera.position.z = Math.max(-mapLimit, Math.min(mapLimit, camera.position.z));
    }

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
    if (selectedMap === 'facility' && camera.position.z <= -120) {
      // 樓梯斜坡：從 z = -120 (y = 0) 到 z = -135 (y = 5.0)
      const ratio = (camera.position.z - (-120)) / (-135 - (-120)); // 在 -120 處為 0，在 -135 處為 1
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      const stairsY = clampedRatio * 5.0;
      if (stairsY > highestUnderPlayer) {
        highestUnderPlayer = stairsY;
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
    // 6.X 戰術手電筒動態追蹤 (電力中斷事件下)
    // ------------------------------------------
    if (selectedMap === 'facility' && facilityEvent === 'blackout') {
      if (flashlightRef.current && targetRef.current) {
        flashlightRef.current.position.copy(camera.position);
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        targetRef.current.position.copy(camera.position).addScaledVector(dir, 15);
        flashlightRef.current.target = targetRef.current;
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
const getWaveForZone = (zone) => {
  if (zone >= 7) return 1;
  if (zone >= 4) return 2;
  return 3;
};

const triggerFacilityEvent = (event, zoneNum, addFeedCallback) => {
  if (event === 'blackout') {
    addFeedCallback(`⚠️ 區域電力中斷！請利用槍上的戰術手電筒照明。`, 'system');
  } else if (event === 'fog') {
    addFeedCallback(`⚠️ 化學濃霧襲來！能見度極低，注意近戰突擊！`, 'headshot');
  } else if (event === 'alert') {
    addFeedCallback(`⚠️ 紅色警報已響起！敵戰鬥力增強，小心防禦！`, 'headshot');
  } else if (event === 'warp') {
    addFeedCallback(`⚠️ 空間扭曲！通道結構已發生非線性異常。`, 'system');
  } else if (event === 'combat') {
    addFeedCallback(`⚠️ 遭遇交戰區域！我方特種部隊正在與敵軍交火，支援他們！`, 'system');
  } else {
    addFeedCallback(`已進入第 ${zoneNum} 出口區域，目前狀況安全無異常。`, 'system');
  }
};

// 7. 遊戲主架構 App Component
// ==========================================
export default function App() {
  const [gameState, setGameState] = useState('deploying');
  const [facilityZone, setFacilityZone] = useState(8);
  const [adminTeleportTrigger, setAdminTeleportTrigger] = useState(0);
  const [facilityEvent, setFacilityEvent] = useState('normal'); // 'normal' | 'blackout' | 'fog' | 'alert'
  const [isLocked, setIsLocked] = useState(false);
  const [device, setDevice] = useState(null); // null, 'pc', 'mobile'

  // 受傷方向指示器與相機參考
  const cameraRef = useRef();
  const flashlightRef = useRef();
  const targetRef = useRef();
  const [damageIndicators, setDamageIndicators] = useState([]);

  // 定期清理已過期（超過 1.5 秒）的受傷方向指示器
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setDamageIndicators((prev) => {
        const filtered = prev.filter((ind) => now - ind.createdAt < 1500);
        if (filtered.length === prev.length) return prev;
        return filtered;
      });
    }, 100);
    return () => clearInterval(timer);
  }, []);

  // ==========================================
  // 帳號系統狀態 (Account System States)
  // ==========================================
  const [currentUser, setCurrentUser] = useState(null);
  const [authTab, setAuthTab] = useState('login'); // 'login' or 'register' or 'gamekey'
  const [authForm, setAuthForm] = useState({
    username: '',
    nickname: '',
    password: '',
    confirmPassword: '',
    gameKey: '',
    otpToken: '',
  });
  const [authError, setAuthError] = useState('');
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [endgameStats, setEndgameStats] = useState(null);
  const [lobbyTab, setLobbyTab] = useState('stats'); // 'stats' or 'shop' or 'merchant'
  const [selectedMap, setSelectedMap] = useState('outpost'); // 'outpost' | 'facility'
  const [isAdminConsoleExpanded, setIsAdminConsoleExpanded] = useState(false);

  // ==========================================
  // 格狀倉庫與拖曳狀態 (Grid Stash & Drag-and-Drop States)
  // ==========================================
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverCell, setDragOverCell] = useState(null); // { r, c }
  const [draggedItemRotated, setDraggedItemRotated] = useState(false);
  const [activeContextMenu, setActiveContextMenu] = useState(null); // { x, y, itemUid, type, from: 'stash'|'loadout', slot }
  const [activeHoverSlot, setActiveHoverSlot] = useState(null); // slot name being hovered

  // 鍵盤 'R' 旋轉監聽器
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.code === 'KeyR' || e.key === 'r' || e.key === 'R') && draggedItem) {
        setDraggedItemRotated(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draggedItem]);

  // 全域點擊關閉右鍵選單
  useEffect(() => {
    const handleCloseMenu = () => setActiveContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  // 遊客模式同步輔助：將 gridStashItems 同步至 stash 數量表以保持相容
  const syncGuestStashQuantities = (user) => {
    if (!user.stash) {
      user.stash = {
        m4a1: 0, ak47: 0, awp: 0, mp5: 0, m870: 0, m9: 0, deagle: 0,
        bodyArmor: 0, opsHelmet: 0, grenade: 0, medkit: 0,
        goldBar: 0, hardDrive: 0, dogTag: 0, keycard: 0, flashbang: 0, smoke: 0, knife: 0
      };
    }
    Object.keys(user.stash).forEach(k => {
      user.stash[k] = 0;
    });
    if (user.gridStashItems) {
      user.gridStashItems.forEach(item => {
        if (user.stash[item.type] !== undefined) {
          user.stash[item.type] += 1;
        } else {
          user.stash[item.type] = 1;
        }
      });
    }
  };

  // 遊客模式：移動物品
  const guestMoveGridItem = (user, itemUid, r, c) => {
    const updated = { ...user };
    updated.gridStashItems = updated.gridStashItems.map(i => ({ ...i }));
    const item = updated.gridStashItems.find(i => i.uid === itemUid);
    if (!item) return updated;

    const [w, h] = getItemSize(item.type, item);
    if (c < 0 || c + w > 10 || r < 0) {
      throw new Error('物品位置超出邊界！');
    }

    for (const other of updated.gridStashItems) {
      if (other.uid === itemUid) continue;
      const [ow, oh] = getItemSize(other.type, other);
      const xOverlap = !(c + w <= other.c || other.c + ow <= c);
      const yOverlap = !(r + h <= other.r || other.r + oh <= r);
      if (xOverlap && yOverlap) {
        throw new Error('位置已被佔用，無法放置！');
      }
    }

    item.r = r;
    item.c = c;
    return updated;
  };

  // 遊客模式：旋轉物品
  const guestRotateGridItem = (user, itemUid) => {
    const updated = { ...user };
    updated.gridStashItems = updated.gridStashItems.map(i => ({ ...i }));
    const item = updated.gridStashItems.find(i => i.uid === itemUid);
    if (!item) return updated;

    const [baseW, baseH] = getItemSize(item.type);
    const nextRotated = !item.rotated;
    const w = nextRotated ? baseH : baseW;
    const h = nextRotated ? baseW : baseH;

    if (item.c + w > 10 || item.r + h > 40) {
      throw new Error('旋轉後物品超出邊界！');
    }

    for (const other of updated.gridStashItems) {
      if (other.uid === itemUid) continue;
      const [ow, oh] = getItemSize(other.type, other);
      const xOverlap = !(item.c + w <= other.c || other.c + ow <= item.c);
      const yOverlap = !(item.r + h <= other.r || other.r + oh <= item.r);
      if (xOverlap && yOverlap) {
        throw new Error('空間已被其他物品佔用，無法旋轉！');
      }
    }

    item.rotated = nextRotated;
    return updated;
  };

  // 遊客模式：配裝穿戴
  const guestEquipItem = (user, slot, itemUid) => {
    const updated = { ...user };
    updated.gridStashItems = updated.gridStashItems.map(i => ({ ...i }));
    if (!updated.equipped) {
      updated.equipped = {
        primaryWeapon: null,
        primaryAttachments: { sight: null, muzzle: null, grip: null, magazine: null },
        secondaryWeapon: null,
        secondaryAttachments: { sight: null, muzzle: null, grip: null, magazine: null },
        bodyArmor: false,
        opsHelmet: false,
        grenades: 0,
        medkits: 0
      };
    } else {
      updated.equipped = { ...updated.equipped };
      if (updated.equipped.primaryAttachments) updated.equipped.primaryAttachments = { ...updated.equipped.primaryAttachments };
      if (updated.equipped.secondaryAttachments) updated.equipped.secondaryAttachments = { ...updated.equipped.secondaryAttachments };
    }

    if (slot === 'primaryWeapon' || slot === 'secondaryWeapon') {
      const idx = updated.gridStashItems.findIndex(i => i.uid === itemUid);
      if (idx === -1) throw new Error('倉庫中無此武器！');
      const item = updated.gridStashItems[idx];

      // 卸下原裝備
      if (updated.equipped[slot]) {
        const prevType = updated.equipped[slot];
        const space = findEmptySpace(updated.gridStashItems, ...getItemSize(prevType));
        if (!space) throw new Error('倉庫已滿，無法卸下原裝備！');

        const attKey = slot === 'primaryWeapon' ? 'primaryAttachments' : 'secondaryAttachments';
        updated.gridStashItems.push({
          uid: generateUid(),
          type: prevType,
          r: space.r,
          c: space.c,
          attachments: { ...updated.equipped[attKey] }
        });
      }

      updated.equipped[slot] = item.type;
      const attKey = slot === 'primaryWeapon' ? 'primaryAttachments' : 'secondaryAttachments';
      updated.equipped[attKey] = item.attachments ? { ...item.attachments } : { sight: null, muzzle: null, grip: null, magazine: null };
      updated.gridStashItems.splice(idx, 1);
    }
    else if (slot === 'bodyArmor' || slot === 'opsHelmet' || slot === 'laserSight' || slot === 'suppressor') {
      const idx = updated.gridStashItems.findIndex(i => i.type === slot);
      if (idx === -1) throw new Error('倉庫中無此裝備或配件！');

      if (updated.equipped[slot]) {
        const space = findEmptySpace(updated.gridStashItems, ...getItemSize(slot));
        if (!space) throw new Error('倉庫已滿，無法卸下原裝備！');
        updated.gridStashItems.push({
          uid: generateUid(),
          type: slot,
          r: space.r,
          c: space.c
        });
      }

      updated.equipped[slot] = true;
      updated.gridStashItems.splice(idx, 1);
    }
    else if (slot === 'grenades' || slot === 'medkits') {
      const type = slot === 'grenades' ? 'grenade' : 'medkit';
      const idx = updated.gridStashItems.findIndex(i => i.type === type);
      if (idx === -1) throw new Error('倉庫中無此消耗品！');
      updated.equipped[slot] = (updated.equipped[slot] || 0) + 1;
      updated.gridStashItems.splice(idx, 1);
    }

    syncGuestStashQuantities(updated);
    return updated;
  };

  // 遊客模式：卸下配裝
  const guestUnequipItem = (user, slot) => {
    const updated = { ...user };
    updated.gridStashItems = updated.gridStashItems.map(i => ({ ...i }));
    if (!updated.equipped) return updated;
    updated.equipped = { ...updated.equipped };
    if (updated.equipped.primaryAttachments) updated.equipped.primaryAttachments = { ...updated.equipped.primaryAttachments };
    if (updated.equipped.secondaryAttachments) updated.equipped.secondaryAttachments = { ...updated.equipped.secondaryAttachments };

    if (slot === 'primaryWeapon' || slot === 'secondaryWeapon') {
      if (updated.equipped[slot]) {
        const type = updated.equipped[slot];
        const space = findEmptySpace(updated.gridStashItems, ...getItemSize(type));
        if (!space) throw new Error('倉庫已滿，請先整理出空間！');

        const attKey = slot === 'primaryWeapon' ? 'primaryAttachments' : 'secondaryAttachments';
        updated.gridStashItems.push({
          uid: generateUid(),
          type: type,
          r: space.r,
          c: space.c,
          attachments: { ...updated.equipped[attKey] }
        });
        updated.equipped[slot] = null;
        updated.equipped[attKey] = { sight: null, muzzle: null, grip: null, magazine: null };
      }
    }
    else if (slot === 'bodyArmor' || slot === 'opsHelmet' || slot === 'laserSight' || slot === 'suppressor') {
      if (updated.equipped[slot]) {
        const space = findEmptySpace(updated.gridStashItems, ...getItemSize(slot));
        if (!space) throw new Error('倉庫已滿，請先整理出空間！');
        updated.gridStashItems.push({
          uid: generateUid(),
          type: slot,
          r: space.r,
          c: space.c
        });
        updated.equipped[slot] = false;
      }
    }
    else if (slot === 'grenades' || slot === 'medkits') {
      if (updated.equipped[slot] > 0) {
        const type = slot === 'grenades' ? 'grenade' : 'medkit';
        const space = findEmptySpace(updated.gridStashItems, 1, 1);
        if (!space) throw new Error('倉庫已滿，請先整理出空間！');
        updated.gridStashItems.push({
          uid: generateUid(),
          type: type,
          r: space.r,
          c: space.c
        });
        updated.equipped[slot] -= 1;
      }
    }

    syncGuestStashQuantities(updated);
    return updated;
  };

  const getAdjustedLootContainers = () => {
    return LOOT_CONTAINERS.map(c => {
      if (selectedMap === 'facility') {
        const pos = c.position.clone();
        if (c.id === 1) pos.set(-3.5, 0.4, 40);
        else if (c.id === 2) pos.set(3.5, 0.4, -20);
        else if (c.id === 3) pos.set(-3.5, 0.4, -50);
        else if (c.id === 4) pos.set(3.5, 0.4, 15);
        else if (c.id === 5) pos.set(-3.5, 0.4, -10);
        else if (c.id === 6) pos.set(3.5, 0.4, 60);
        return { ...c, position: pos };
      }
      return c;
    });
  };

  // 雙重驗證 OTP 動態金鑰相關狀態與邏輯
  const [currentOtp, setCurrentOtp] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(30);

  const getOtp = (timeMs) => {
    const t = Math.floor(timeMs / 30000);
    const secretMultiplier = 98317;
    return String((t * secretMultiplier) % 1000000).padStart(6, '0');
  };

  useEffect(() => {
    setCurrentOtp(getOtp(Date.now()));
    const interval = setInterval(() => {
      const now = Date.now();
      const secondsLeft = 30 - Math.floor((now % 30000) / 1000);
      setOtpCountdown(secondsLeft);
      if (secondsLeft === 30 || secondsLeft === 0) {
        setCurrentOtp(getOtp(now));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // 遊戲心理學機制狀態
  const [damagePopups, setDamagePopups] = useState([]);
  const [isAmbushActive, setIsAmbushActive] = useState(false);
  const [isAmbushAlertVisible, setIsAmbushAlertVisible] = useState(false);
  const [secretMerchantActive, setSecretMerchantActive] = useState(false);
  const [secretMerchantItems, setSecretMerchantItems] = useState([]);
  const [contracts, setContracts] = useState([
    { id: 'extract', desc: '成功戰術撤離 1 次', progress: 0, target: 1, reward: 500, done: false, claimed: false },
    { id: 'kills', desc: '累積擊殺 15 名敵人', progress: 0, target: 15, reward: 400, done: false, claimed: false },
    { id: 'headshots', desc: '達成 5 次爆頭擊殺', progress: 0, target: 5, reward: 300, done: false, claimed: false },
    { id: 'loot_safe', desc: '搜刮 1 次加密保險箱', progress: 0, target: 1, reward: 250, done: false, claimed: false }
  ]);

  const [leaderboardType, setLeaderboardType] = useState('global');
  const [cloudLeaderboard, setCloudLeaderboard] = useState([]);
  const [isCloudLoading, setIsCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState('idle');

  const loadCloudLeaderboard = async () => {
    setIsCloudLoading(true);
    setCloudError(null);
    try {
      const data = await fetchCloudLeaderboard();
      setCloudLeaderboard(data);
    } catch (err) {
      console.error(err);
      setCloudError('無法載入雲端數據，已自動切換至本機排行。');
      setLeaderboardType('local');
    } finally {
      setIsCloudLoading(false);
    }
  };

  // 當回到登入畫面/大廳時，自動讀取雲端排行榜
  useEffect(() => {
    if (gameState === 'deploying') {
      loadCloudLeaderboard();
    }
  }, [gameState]);

  // 登入時載入或初始化該使用者的合約進度
  useEffect(() => {
    if (currentUser) {
      if (currentUser.contracts) {
        setContracts(currentUser.contracts);
      } else {
        setContracts([
          { id: 'extract', desc: '成功戰術撤離 1 次', progress: 0, target: 1, reward: 500, done: false, claimed: false },
          { id: 'kills', desc: '累積擊殺 15 名敵人', progress: 0, target: 15, reward: 400, done: false, claimed: false },
          { id: 'headshots', desc: '達成 5 次爆頭擊殺', progress: 0, target: 5, reward: 300, done: false, claimed: false },
          { id: 'loot_safe', desc: '搜刮 1 次加密保險箱', progress: 0, target: 1, reward: 250, done: false, claimed: false }
        ]);
      }
    } else {
      setContracts([
        { id: 'extract', desc: '成功戰術撤離 1 次', progress: 0, target: 1, reward: 500, done: false, claimed: false },
        { id: 'kills', desc: '累積擊殺 15 名敵人', progress: 0, target: 15, reward: 400, done: false, claimed: false },
        { id: 'headshots', desc: '達成 5 次爆頭擊殺', progress: 0, target: 5, reward: 300, done: false, claimed: false },
        { id: 'loot_safe', desc: '搜刮 1 次加密保險箱', progress: 0, target: 1, reward: 250, done: false, claimed: false }
      ]);
    }
  }, [currentUser]);

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

  // 衍生狀態 (配件改裝影響)
  const primaryWeaponId = currentUser?.equipped?.primaryWeapon || null;
  const secondaryWeaponId = currentUser?.equipped?.secondaryWeapon || null;

  const primaryConfig = useMemo(() => {
    return getModifiedWeaponConfig(WEAPON_CONFIGS[primaryWeaponId], currentUser?.equipped?.primaryAttachments);
  }, [primaryWeaponId, currentUser?.equipped?.primaryAttachments]);

  const secondaryConfig = useMemo(() => {
    return getModifiedWeaponConfig(WEAPON_CONFIGS[secondaryWeaponId], currentUser?.equipped?.secondaryAttachments);
  }, [secondaryWeaponId, currentUser?.equipped?.secondaryAttachments]);

  const activeWeaponId = activeWeapon === 'primary' ? primaryWeaponId : secondaryWeaponId;
  const weaponConfig = activeWeapon === 'primary' ? primaryConfig : secondaryConfig;

  const fireMode = weaponConfig ? (weaponConfig.fireMode === 'auto' ? (activeWeapon === 'primary' ? primaryFireMode : 'semi') : 'semi') : 'semi';
  const ammo = activeWeapon === 'primary' ? primaryAmmo : secondaryAmmo;
  const setAmmo = activeWeapon === 'primary' ? setPrimaryAmmo : setSecondaryAmmo;

  // 改裝槍械與拖曳狀態 (Gunsmith & Drag-and-Drop Stash)
  const [gunsmithWeapon, setGunsmithWeapon] = useState(null);
  const [gunsmithActiveSlot, setGunsmithActiveSlot] = useState('sight');

  // 戰術裝備與拋殼實體狀態
  const [grenades, setGrenades] = useState(2);
  const [grenadeEntities, setGrenadeEntities] = useState([]);
  const [enemyGrenadeEntities, setEnemyGrenadeEntities] = useState([]);
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

  // 近戰與戰術投擲狀態
  const [isMeleeing, setIsMeleeing] = useState(false);
  const meleeProgress = useRef(0);
  const meleeTimeoutRef = useRef(null);
  const [activeThrowable, setActiveThrowable] = useState('grenade');
  const [flashbangs, setFlashbangs] = useState(2);
  const [smokes, setSmokes] = useState(2);
  const [smokeClouds, setSmokeClouds] = useState([]);
  const smokeCloudsRef = useRef([]);
  useEffect(() => {
    smokeCloudsRef.current = smokeClouds;
  }, [smokeClouds]);
  const [flashIntensity, setFlashIntensity] = useState(0);
  const flashIntensityRef = useRef(0);

  const [eliminated, setEliminated] = useState(0);

  // 畫面閃紅受傷特效狀態
  const [hurtActive, setHurtActive] = useState(false);
  const [shieldBlockActive, setShieldBlockActive] = useState(false);

  // 阻止行動端瀏覽器預設的多指 pinch 縮放手勢
  useEffect(() => {
    const preventPinchZoom = (e) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    document.addEventListener('touchstart', preventPinchZoom, { passive: false });
    document.addEventListener('touchmove', preventPinchZoom, { passive: false });

    return () => {
      document.removeEventListener('touchstart', preventPinchZoom);
      document.removeEventListener('touchmove', preventPinchZoom);
    };
  }, []);

  // 局內波次與物資搜刮狀態
  const [currentWave, setCurrentWave] = useState(1);
  const [waveCountdown, setWaveCountdown] = useState(0);
  const [backpackItems, setBackpackItems] = useState([]);
  const [backpackCoins, setBackpackCoins] = useState(0);

  const backpack = useMemo(() => {
    const counts = { goldBar: 0, hardDrive: 0, dogTag: 0, grenade: 0, medkit: 0, coins: backpackCoins };
    backpackItems.forEach(item => {
      if (counts[item.type] !== undefined) {
        counts[item.type] += 1;
      }
    });
    return counts;
  }, [backpackItems, backpackCoins]);

  const [lootedContainers, setLootedContainers] = useState({});
  const [nearContainer, setNearContainer] = useState(null);
  const [isLooting, setIsLooting] = useState(false);
  const [lootProgress, setLootProgress] = useState(0);
  const [lootPopup, setLootPopup] = useState(null);
  const [medkits, setMedkits] = useState(2);

  // 局內搜刮彈出視窗與物資狀態
  const [isLootModalOpen, setIsLootModalOpen] = useState(false);
  const [containerLootItems, setContainerLootItems] = useState([]);
  const [containerLootCoins, setContainerLootCoins] = useState(0);

  const nearContainerRef = useRef(nearContainer);
  useEffect(() => {
    nearContainerRef.current = nearContainer;
  }, [nearContainer]);

  const backpackRef = useRef(backpack);
  useEffect(() => {
    backpackRef.current = backpack;
  }, [backpack]);

  // 戰術直升機撤離狀態
  const [extractionActive, setExtractionActive] = useState(false);
  const [extractionState, setExtractionState] = useState('idle'); // 'idle' | 'incoming' | 'landed' | 'extracting' | 'extracted'
  const [extractionCountdown, setExtractionCountdown] = useState(5.0);
  const [isPlayerInExtractionZone, setIsPlayerInExtractionZone] = useState(false);

  // 敵人、粒子特效、彈孔貼紙狀態
  const [enemies, setEnemies] = useState(() => spawnEnemies(false, 1.0, false, 'outpost'));
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

  // 波次生存挑戰自動倒數
  useEffect(() => {
    if (waveCountdown > 0) {
      const timer = setTimeout(() => {
        setWaveCountdown((prev) => {
          if (prev <= 1) {
            setCurrentWave((w) => {
              const nextWave = w + 1;
              setEnemies(spawnWave(nextWave, getDifficultyMultiplier(), isAmbushActive, selectedMap));
              addKillFeedEntry(`第 ${nextWave} 波敵軍已進入戰區！`, 'system');
              return nextWave;
            });
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [waveCountdown]);

  // 戰術煙霧彈氣體消散倒數
  useEffect(() => {
    if (smokeClouds.length === 0) return;
    const interval = setInterval(() => {
      setSmokeClouds((prev) => {
        return prev
          .map((cloud) => ({ ...cloud, timeLeft: cloud.timeLeft - 0.5 }))
          .filter((cloud) => cloud.timeLeft > 0);
      });
    }, 500);
    return () => clearInterval(interval);
  }, [smokeClouds.length]);

  // 戰術閃光彈致盲消退
  useEffect(() => {
    if (flashIntensity === 0) return;
    const interval = setInterval(() => {
      setFlashIntensity((prev) => {
        const next = Math.max(0, prev - 0.05);
        flashIntensityRef.current = next;
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [flashIntensity]);

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
    const primaryId = currentUser?.equipped?.primaryWeapon || null;
    const secondaryId = currentUser?.equipped?.secondaryWeapon || null;
    if (!primaryId || !secondaryId) return; // Cannot switch if one of the slots is empty!

    if (isReloading) {
      setIsReloading(false);
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    }
    setActiveWeapon((prev) => (prev === 'primary' ? 'secondary' : 'primary'));
    soundManager.playWeaponSwitch();
  };

  const triggerReload = () => {
    if (gameState !== 'active' || isReloading || isHealing) return;

    const primaryWeaponId = currentUser?.equipped?.primaryWeapon || null;
    const secondaryWeaponId = currentUser?.equipped?.secondaryWeapon || null;
    const activeWeaponId = activeWeapon === 'primary' ? primaryWeaponId : secondaryWeaponId;
    if (!activeWeaponId) return; // cannot reload if no weapon!
    const weaponConfig = activeWeapon === 'primary' ? primaryConfig : secondaryConfig;

    const currentAmmo = activeWeapon === 'primary' ? primaryAmmo : secondaryAmmo;
    const maxAmmo = weaponConfig?.maxAmmo || 30;

    if (currentAmmo < maxAmmo) {
      setIsReloading(true);
      if (weaponConfig?.isPrimary) {
        soundManager.playReload();
      } else {
        soundManager.playPistolReload();
      }
      const baseTime = weaponConfig?.isPrimary ? 1500 : 1000;
      const reloadTime = baseTime * (weaponConfig?.reloadTimeFactor || 1);
      reloadTimeoutRef.current = setTimeout(() => {
        if (activeWeapon === 'primary') {
          setPrimaryAmmo(maxAmmo);
        } else {
          setSecondaryAmmo(maxAmmo);
        }
        setIsReloading(false);
      }, reloadTime);
    }
  };

  const triggerHeal = () => {
    if (gameState !== 'active' || isHealing || isReloading) return;
    const maxHealth = currentUser?.equipped?.bodyArmor ? 150 : 100;
    if (health >= maxHealth) return;
    if (medkits <= 0) {
      addKillFeedEntry("無可用醫療包！", "system");
      return;
    }
    
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
      setHealth(maxHealth);
      setMedkits((prev) => Math.max(0, prev - 1));
      setIsHealing(false);
      setHealProgress(0);
      soundManager.playSuccessChime();
    }, duration);
  };

  const lootIntervalRef = useRef(null);

  const startLooting = () => {
    if (isLooting || isHealing || isReloading || !nearContainer) return;

    // 檢查鑰匙卡鎖定機制 (Check Keycard Locks)
    if (nearContainer.requiresKeycard) {
      const hasKeycard = currentUser?.gridStashItems?.some(item => item.type === 'keycard') || (currentUser?.stash?.keycard > 0);
      if (!hasKeycard) {
        setLootPopup({
          title: '⚠️ 容器已鎖定 LOCKED',
          content: '需要 [安全實驗室鑰匙卡] 才能開啟此保險箱！'
        });
        setTimeout(() => setLootPopup(null), 3500);
        return;
      }
    }

    setIsLooting(true);
    setLootProgress(0);
    
    if (lootIntervalRef.current) clearInterval(lootIntervalRef.current);
    
    let progress = 0;
    // 依容器類型決定不同搜刮時長
    let duration = 2500; // 預設 2.5s
    if (nearContainer.type === 'pc') duration = 3000;
    else if (nearContainer.type === 'locked_safe') duration = 4500;
    else if (nearContainer.type === 'safe') duration = 3500;
    else if (nearContainer.type === 'weapon') duration = 3000;
    else if (nearContainer.type === 'med') duration = 2000;

    const intervalTime = 50;
    const step = (intervalTime / duration) * 100;
    
    lootIntervalRef.current = setInterval(() => {
      progress += step;
      if (progress >= 100) {
        clearInterval(lootIntervalRef.current);
        setLootProgress(100);
        setIsLooting(false);
        handleCompleteLoot();
      } else {
        setLootProgress(progress);
      }
    }, intervalTime);
  };

  const stopLooting = () => {
    if (lootIntervalRef.current) {
      clearInterval(lootIntervalRef.current);
      lootIntervalRef.current = null;
    }
    setIsLooting(false);
    setLootProgress(0);
  };

  const handleCompleteLoot = () => {
    if (!nearContainerRef.current) return;
    const container = nearContainerRef.current;
    const containerId = container.id;
    
    setLootedContainers((prev) => ({
      ...prev,
      [containerId]: true
    }));
    
    let items = [];
    let coins = 0;
    
    if (containerId === 1) {
      // 武器箱
      coins = Math.floor(100 + Math.random() * 150);
      const grenadeCount = Math.random() < 0.6 ? 1 : 2;
      for (let i = 0; i < grenadeCount; i++) {
        items.push({ uid: generateUid(), type: 'grenade' });
      }
      // 機率掉落彈藥/配件/槍枝！
      if (Math.random() < 0.3) {
        const weaponTypes = ['m4a1', 'mp5', 'm9'];
        const wType = weaponTypes[Math.floor(Math.random() * weaponTypes.length)];
        items.push({ uid: generateUid(), type: wType });
      }
    } else if (containerId === 2) {
      // 醫療箱
      const medCount = Math.random() < 0.6 ? 1 : 2;
      const dogTagCount = Math.floor(1 + Math.random() * 2);
      for (let i = 0; i < medCount; i++) {
        items.push({ uid: generateUid(), type: 'medkit' });
      }
      for (let i = 0; i < dogTagCount; i++) {
        items.push({ uid: generateUid(), type: 'dogTag' });
      }
    } else if (containerId === 3) {
      // 保險箱
      const hasGold = Math.random() < 0.5;
      const hasDrive = Math.random() < 0.5;
      coins = Math.floor(200 + Math.random() * 300);
      if (hasGold) items.push({ uid: generateUid(), type: 'goldBar' });
      if (hasDrive) items.push({ uid: generateUid(), type: 'hardDrive' });
    } else if (containerId === 5) {
      // 電腦主機
      coins = Math.floor(50 + Math.random() * 100);
      if (Math.random() < 0.6) items.push({ uid: generateUid(), type: 'hardDrive' });
      if (Math.random() < 0.15) items.push({ uid: generateUid(), type: 'keycard' }); // 電腦機率刷出實驗室鑰匙卡！
    } else if (containerId === 6) {
      // 實驗室密室保險箱
      coins = Math.floor(400 + Math.random() * 400);
      if (Math.random() < 0.8) items.push({ uid: generateUid(), type: 'goldBar' });
      if (Math.random() < 0.6) items.push({ uid: generateUid(), type: 'hardDrive' });
      const tagCount = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < tagCount; i++) {
        items.push({ uid: generateUid(), type: 'dogTag' });
      }
      // 極低機率掉落一把 AWP 狙擊槍！
      if (Math.random() < 0.15) {
        items.push({ uid: generateUid(), type: 'awp' });
      }
    } else {
      // 預設箱
      const hasTag = Math.random() < 0.4;
      coins = Math.floor(80 + Math.random() * 120);
      const medCount = Math.random() < 0.5 ? 1 : 0;
      if (hasTag) items.push({ uid: generateUid(), type: 'dogTag' });
      if (medCount > 0) items.push({ uid: generateUid(), type: 'medkit' });
    }
    
    setContainerLootItems(items);
    setContainerLootCoins(coins);
    setIsLootModalOpen(true);
    
    // 解鎖滑鼠指標控制以利拖曳
    if (device === 'pc' && controlsRef.current) {
      controlsRef.current.unlock();
    } else {
      setIsLocked(false);
    }
    
    soundManager.playSuccessChime();
    addKillFeedEntry(`玩家搜刮了 ${container.name}`, 'system');
    setNearContainer(null);

    if (container.id === 3 || container.id === 6) {
      updateContractProgress('loot_safe');
    }
  };

  const handleTakeItem = (item) => {
    setBackpackItems(prev => [...prev, item]);
    setContainerLootItems(prev => prev.filter(i => i.uid !== item.uid));
    soundManager.playSuccessChime();
  };

  const handleTakeCoins = () => {
    setBackpackCoins(prev => prev + containerLootCoins);
    setContainerLootCoins(0);
    soundManager.playSuccessChime();
  };

  const handleTakeAll = () => {
    if (containerLootItems.length > 0) {
      setBackpackItems(prev => [...prev, ...containerLootItems]);
    }
    setBackpackCoins(prev => prev + containerLootCoins);
    setContainerLootItems([]);
    setContainerLootCoins(0);
    soundManager.playSuccessChime();
  };

  const handleCloseLootModal = () => {
    setIsLootModalOpen(false);
    setTimeout(() => {
      if (device === 'pc' && controlsRef.current) {
        controlsRef.current.lock();
      } else if (device === 'mobile') {
        setIsLocked(true);
      }
    }, 100);
  };

  const triggerMelee = () => {
    if (gameState !== 'active' || isHealing || isReloading || isMeleeing || !isLocked) return;
    setIsMeleeing(true);
    
    // 播放合成揮刀音效
    soundManager.playMeleeSwipe();
    
    // 近戰判定：2.8 米距離以內且在扇形夾角內的敵人
    const playerPos = cameraRef.current ? cameraRef.current.position.clone() : new THREE.Vector3(0, 1.6, 95);
    const dir = new THREE.Vector3();
    if (cameraRef.current) {
      cameraRef.current.getWorldDirection(dir);
    } else {
      dir.set(0, 0, -1);
    }
    
    let hitAny = false;
    
    setEnemies((prevEnemies) => {
      return prevEnemies.map((enemy) => {
        if (enemy.state === 'alive') {
          const enemyPos = enemy.position.clone();
          enemyPos.y = 1.0; // 假設軀幹高度為 1.0
          const dist = playerPos.distanceTo(enemyPos);
          
          if (dist < 2.8) {
            // 計算夾角點積
            const toEnemy = enemyPos.clone().sub(playerPos).normalize();
            const dot = dir.dot(toEnemy);
            if (dot > 0.5) { // 約為正面 60 度範圍
              hitAny = true;
              const newHp = Math.max(0, enemy.hp - 120); // 120 點傷害 (一般 AI 為 100 點)
              const isDead = newHp <= 0;
              
              triggerHitMarker(isDead);
              
              const enemyTypeName = enemy.enemyType ? enemy.enemyType.toUpperCase() : 'ENEMY';
              const enemyName = `${enemyTypeName}_0${enemy.id}`;
              
              if (isDead) {
                soundManager.playEnemyDeath();
                addKillFeedEntry(`PLAYER ➔ [KNIFE] ${enemyName}`, 'normal');
              } else {
                soundManager.playPlayerHurt();
              }
              
              return {
                ...enemy,
                hp: newHp,
                state: isDead ? 'dying' : 'alive'
              };
            }
          }
        }
        return enemy;
      });
    });

    if (hitAny) {
      soundManager.playKnifeHit();
    }

    // 啟動近戰揮刀 LERP
    meleeProgress.current = 0;
    const interval = setInterval(() => {
      meleeProgress.current += 0.1;
      if (meleeProgress.current >= 1.0) {
        clearInterval(interval);
      }
    }, 30);

    if (meleeTimeoutRef.current) clearTimeout(meleeTimeoutRef.current);
    meleeTimeoutRef.current = setTimeout(() => {
      setIsMeleeing(false);
      meleeProgress.current = 0;
    }, 400);
  };

  const triggerFireMode = () => {
    if (gameState !== 'active') return;
    if (activeWeapon === 'secondary') return; // M9 鎖定半自動
    if (!currentUser?.equipped?.primaryWeapon) return; // Cannot switch if no primary weapon!
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

  // 監聽 4 鍵切換戰術投擲物 (HE手榴彈 ➔ 戰術閃光彈 ➔ 戰術煙霧彈)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gameState !== 'active' || !isLocked) return;
      if (e.code === 'Digit4') {
        setActiveThrowable((prev) => {
          let next = 'grenade';
          if (prev === 'grenade') next = 'flashbang';
          else if (prev === 'flashbang') next = 'smoke';
          
          soundManager.playWeaponSwitch();
          addKillFeedEntry(`戰術投擲物已切換為：${next === 'grenade' ? 'HE 手榴彈' : next === 'flashbang' ? '戰術閃光彈' : '戰術煙霧彈'}`, 'system');
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, isLocked]);

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

  // 監聽 V 鍵觸發戰術近戰攻擊 (Melee Knife Attack)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gameState !== 'active' || !isLocked || isHealing || isReloading || isMeleeing) return;
      if (e.code === 'KeyV') {
        triggerMelee();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, isLocked, isHealing, isReloading, isMeleeing]);

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

  // 管理員專用作弊快捷鍵監聽
  useEffect(() => {
    if (!currentUser?.isAdmin || gameState !== 'active') return;

    const handleAdminKeys = (e) => {
      if (e.code === 'KeyO') {
        // [KeyO] 跳過波次：清空當前波次敵人
        setEnemies([]);
        if (selectedMap === 'facility') {
          setAdminTeleportTrigger((prev) => prev + 1);
          if (facilityZone > 1) {
            addKillFeedEntry(`管理員使用 [O] 鍵跳過當前區域！第 ${facilityZone} 出口區域敵軍已清除！請前往長廊盡頭以進入下一區。`, 'system');
          } else {
            addKillFeedEntry('管理員使用 [O] 鍵跳過當前區域！第 1 出口區域敵軍已清除！鐵捲門已開啟，請走樓梯撤離！', 'system');
          }
        } else {
          if (currentWave < 3) {
            setWaveCountdown(5);
            addKillFeedEntry('管理員使用 [O] 鍵跳過波次，下一波即將開始...', 'system');
          } else {
            setExtractionActive(true);
            setExtractionState('incoming');
            setExtractionCountdown(5.0);
            addKillFeedEntry('管理員使用 [O] 鍵跳過全部防守波次！已呼叫撤離直升機！', 'system');
            soundManager.startHelicopterSound();
          }
        }
      }
      else if (e.code === 'KeyP') {
        // [KeyP] 恢復血量
        setHealth(100);
        addKillFeedEntry('管理員使用 [P] 鍵恢復生命值為 100%', 'system');
      }
      else if (e.code === 'KeyK') {
        // [KeyK] 直接通關
        setGameState('victory');
        if (controlsRef.current) {
          controlsRef.current.unlock();
        }
        const duration = Math.round((Date.now() - runStatsRef.current.startTime) / 1000);
        const accuracy = runStatsRef.current.shotsFired > 0 ? (runStatsRef.current.shotsHit / runStatsRef.current.shotsFired) : 0.8;
        const total = (eliminated * 50) + 300 + (runStatsRef.current.headshots * 20) + 100;
        setEndgameStats({
          headshots: runStatsRef.current.headshots,
          shotsFired: runStatsRef.current.shotsFired,
          shotsHit: runStatsRef.current.shotsHit,
          playTimeSeconds: duration,
          coinsEarnedDetails: {
            killsCoins: eliminated * 50,
            victoryCoins: 300,
            headshotsCoins: runStatsRef.current.headshots * 20,
            accuracyCoins: 100,
            total: total
          }
        });
        
        if (!currentUser.isGuest) {
          try {
            updateStats(currentUser.username, {
              kills: eliminated,
              victory: true,
              headshots: runStatsRef.current.headshots,
              shotsFired: runStatsRef.current.shotsFired,
              shotsHit: runStatsRef.current.shotsHit,
              playTimeSeconds: duration
            });
          } catch (err) {}
        }
        addKillFeedEntry('管理員使用 [K] 鍵瞬間通關！任務完成！', 'system');
      }
    };

    window.addEventListener('keydown', handleAdminKeys);
    return () => window.removeEventListener('keydown', handleAdminKeys);
  }, [gameState, currentUser, currentWave, eliminated]);

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
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('正在驗證帳號...');
    try {
      const user = await loginAccount(authForm.username, authForm.password);
      setCurrentUser(user);
      setNewNickname(user.nickname);
      setAuthForm({ username: '', nickname: '', password: '', confirmPassword: '', gameKey: '', otpToken: '' });
      setAuthError('');
    } catch (err) {
      setAuthError(err.message);
    }
  };

  // 執行註冊
  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthError('正在建立帳號並同步...');
    if (authForm.password !== authForm.confirmPassword) {
      setAuthError('兩次密碼輸入不一致！');
      return;
    }
    try {
      const user = await registerAccount(authForm.username, authForm.nickname, authForm.password);
      setCurrentUser(user);
      setNewNickname(user.nickname);
      setAuthForm({ username: '', nickname: '', password: '', confirmPassword: '', gameKey: '', otpToken: '' });
      setAuthError('');
    } catch (err) {
      setAuthError(err.message);
    }
  };

  // 執行金鑰雙重驗證登入
  const handleGameKeyLogin = async (e) => {
    e.preventDefault();
    setAuthError('正在進行金鑰雙重驗證...');
    const key = (authForm.gameKey || '').trim().toUpperCase();
    if (key !== 'DELTA-ADMIN-9999-STAR') {
      setAuthError('無效的遊戲金鑰！');
      return;
    }
    const otp = (authForm.otpToken || '').trim();
    const codeCurrent = getOtp(Date.now());
    const codePrev = getOtp(Date.now() - 30000);
    const codeNext = getOtp(Date.now() + 30000);
    if (otp !== codeCurrent && otp !== codePrev && otp !== codeNext) {
      setAuthError('動態驗證碼錯誤或已過期！');
      return;
    }
    try {
      const user = await loginAccountByGameKey(authForm.password);
      setCurrentUser(user);
      setNewNickname(user.nickname);
      setAuthForm({ username: '', nickname: '', password: '', confirmPassword: '', gameKey: '', otpToken: '' });
      setAuthError('');
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
      
      // 同步新暱稱至雲端
      setCloudSyncStatus('syncing');
      syncPlayerToCloud(currentUser.username, newNickname.trim(), updated.stats)
        .then(() => {
          setCloudSyncStatus('done');
          loadCloudLeaderboard();
        })
        .catch(err => {
          console.error(err);
          setCloudSyncStatus('error');
        });
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

  // 局外裝備配置
  const handleEquip = (slot, itemId) => {
    if (!currentUser) return;
    if (currentUser.isGuest) {
      try {
        let finalItemId = itemId;
        if ((slot === 'primaryWeapon' || slot === 'secondaryWeapon') && itemId) {
          const matchedItem = currentUser.gridStashItems?.find(
            i => i.type === itemId || i.uid === itemId
          );
          if (matchedItem) {
            finalItemId = matchedItem.uid;
          }
        }
        const updated = guestEquipItem(currentUser, slot, finalItemId);
        setCurrentUser(updated);
      } catch (err) {
        alert(err.message);
      }
    } else {
      try {
        let finalItemId = itemId;
        if ((slot === 'primaryWeapon' || slot === 'secondaryWeapon') && itemId) {
          const matchedItem = currentUser.gridStashItems?.find(
            i => i.type === itemId || i.uid === itemId
          );
          if (matchedItem) {
            finalItemId = matchedItem.uid;
          }
        }
        const updated = equipItem(currentUser.username, slot, finalItemId);
        setCurrentUser(updated);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const handleUnequip = (slot) => {
    if (!currentUser) return;
    if (currentUser.isGuest) {
      try {
        const updated = guestUnequipItem(currentUser, slot);
        setCurrentUser(updated);
      } catch (err) {
        alert(err.message);
      }
    } else {
      try {
        const updated = unequipItem(currentUser.username, slot);
        setCurrentUser(updated);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  // ==========================================
  // 格狀倉庫拖曳與選單處理函式 (Grid Stash Drag/Drop & Context Menu Helpers)
  // ==========================================
  
  // 判斷物品拖曳至指定槽位是否相容
  const isCompatibleWithSlot = (slot) => {
    if (!draggedItem) return false;
    const type = draggedItem.type;
    if (slot === 'primaryWeapon') return ['m4a1', 'ak47', 'awp', 'mp5', 'm870'].includes(type);
    if (slot === 'secondaryWeapon') return ['m9', 'deagle'].includes(type);
    if (slot === 'bodyArmor') return type === 'bodyArmor';
    if (slot === 'opsHelmet') return type === 'opsHelmet';
    if (slot === 'laserSight') return type === 'laserSight';
    if (slot === 'suppressor') return type === 'suppressor';
    if (slot === 'grenades') return type === 'grenade';
    if (slot === 'medkits') return type === 'medkit';
    return false;
  };

  // 開始拖曳物品
  const handleDragStart = (e, item, from = 'stash', slot = null) => {
    setDraggedItem({ ...item, from, slot });
    setDraggedItemRotated(!!item.rotated);
    e.dataTransfer.setData('text/plain', item.uid || item.type);
    e.dataTransfer.effectAllowed = 'move';
  };

  // 雙擊快速裝備物品
  const handleItemDoubleClick = (item) => {
    let slot = null;
    if (['m4a1', 'ak47', 'awp', 'mp5', 'm870'].includes(item.type)) slot = 'primaryWeapon';
    else if (['m9', 'deagle'].includes(item.type)) slot = 'secondaryWeapon';
    else if (item.type === 'bodyArmor') slot = 'bodyArmor';
    else if (item.type === 'opsHelmet') slot = 'opsHelmet';
    else if (item.type === 'laserSight') slot = 'laserSight';
    else if (item.type === 'suppressor') slot = 'suppressor';
    else if (item.type === 'grenade') slot = 'grenades';
    else if (item.type === 'medkit') slot = 'medkits';
    
    if (slot) {
      handleEquip(slot, item.uid);
    }
  };

  // 右鍵物品選單
  const handleItemContextMenu = (e, item, from = 'stash', slot = null) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveContextMenu({
      x: e.clientX,
      y: e.clientY,
      itemUid: item.uid,
      type: item.type,
      from,
      slot
    });
  };

  // 檢測當前拖曳位置是否可以放置
  const checkDragFits = (item, r, c, isRotated) => {
    if (!currentUser) return false;
    const [baseW, baseH] = getItemSize(item.type);
    const w = isRotated ? baseH : baseW;
    const h = isRotated ? baseW : baseH;
    
    if (c < 0 || c + w > 10 || r < 0 || r + h > 40) return false;
    
    const items = currentUser.gridStashItems || [];
    for (const other of items) {
      if (other.uid === item.uid) continue;
      const [ow, oh] = getItemSize(other.type, other);
      const xOverlap = !(c + w <= other.c || other.c + ow <= c);
      const yOverlap = !(r + h <= other.r || other.r + oh <= r);
      if (xOverlap && yOverlap) return false;
    }
    return true;
  };

  // 放置物品至倉庫網格
  const handleDropOnGrid = (e, targetR, targetC) => {
    e.preventDefault();
    if (!draggedItem) return;
    
    const isGuest = currentUser.isGuest;
    const newRotated = draggedItemRotated;
    
    // 檢查是否能放下
    const fits = checkDragFits(draggedItem, targetR, targetC, newRotated);
    if (!fits) {
      alert('無法在此處放置物品！空間不足、重疊或超出邊界。');
      setDraggedItem(null);
      setDragOverCell(null);
      return;
    }
    
    try {
      if (draggedItem.from === 'loadout') {
        // 從配裝卸下放置到網格指定位置
        let updated;
        if (isGuest) {
          updated = guestUnequipItem(currentUser, draggedItem.slot);
          const newItem = [...updated.gridStashItems].reverse().find(i => i.type === draggedItem.type);
          if (newItem) {
            newItem.rotated = newRotated;
            updated = guestMoveGridItem(updated, newItem.uid, targetR, targetC);
          }
        } else {
          updated = unequipItem(currentUser.username, draggedItem.slot);
          const newItem = [...updated.gridStashItems].reverse().find(i => i.type === draggedItem.type);
          if (newItem) {
            newItem.rotated = newRotated;
            updated = moveGridItem(currentUser.username, newItem.uid, targetR, targetC);
          }
        }
        setCurrentUser(updated);
      } else {
        // 倉庫內移動物品位置與旋轉
        let updated;
        if (isGuest) {
          updated = guestMoveGridItem(currentUser, draggedItem.uid, targetR, targetC);
          const item = updated.gridStashItems.find(i => i.uid === draggedItem.uid);
          if (item) item.rotated = newRotated;
        } else {
          updated = moveGridItem(currentUser.username, draggedItem.uid, targetR, targetC);
          const item = updated.gridStashItems.find(i => i.uid === draggedItem.uid);
          if (item) {
            item.rotated = newRotated;
            const accounts = getAccounts();
            const idx = accounts.findIndex(a => a.username === currentUser.username);
            if (idx > -1) {
              accounts[idx] = updated;
              saveAccounts(accounts);
            }
          }
        }
        setCurrentUser(updated);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setDraggedItem(null);
      setDragOverCell(null);
    }
  };

  // 一鍵整理倉庫
  const handleSortStash = () => {
    if (!currentUser) return;
    try {
      if (currentUser.isGuest) {
        const sortedItems = autoSortStashItems(currentUser.gridStashItems || []);
        const updated = {
          ...currentUser,
          gridStashItems: sortedItems
        };
        if (updated.stash) {
          Object.keys(updated.stash).forEach(k => {
            updated.stash[k] = 0;
          });
          sortedItems.forEach(item => {
            if (updated.stash[item.type] !== undefined) {
              updated.stash[item.type] += 1;
            } else {
              updated.stash[item.type] = 1;
            }
          });
        }
        setCurrentUser(updated);
      } else {
        const updated = sortGridStash(currentUser.username);
        setCurrentUser(updated);
      }
    } catch (err) {
      alert('整理倉庫失敗: ' + err.message);
    }
  };

  // 放置物品至裝備槽
  const handleDropOnSlot = (slot) => {
    if (!draggedItem) return;
    const type = draggedItem.type;
    let allowed = false;
    
    if (slot === 'primaryWeapon') allowed = ['m4a1', 'ak47', 'awp', 'mp5', 'm870'].includes(type);
    else if (slot === 'secondaryWeapon') allowed = ['m9', 'deagle'].includes(type);
    else if (slot === 'bodyArmor') allowed = type === 'bodyArmor';
    else if (slot === 'opsHelmet') allowed = type === 'opsHelmet';
    else if (slot === 'laserSight') allowed = type === 'laserSight';
    else if (slot === 'suppressor') allowed = type === 'suppressor';
    else if (slot === 'grenades') allowed = type === 'grenade';
    else if (slot === 'medkits') allowed = type === 'medkit';
    
    if (allowed) {
      handleEquip(slot, draggedItem.uid || draggedItem.type);
    } else {
      alert(`該物品無法裝備在 ${slot === 'primaryWeapon' ? '主武器' : slot === 'secondaryWeapon' ? '副武器' : '該槽位'} 中！`);
    }
    setDraggedItem(null);
    setDragOverCell(null);
  };

  // 領取任務合約獎勵
  const handleClaimContractReward = (contractId) => {
    if (!currentUser) return;
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return;
    if (!contract.done || contract.claimed) return;

    if (currentUser.isGuest) {
      const reward = contract.reward;
      const updatedUser = {
        ...currentUser,
        coins: (currentUser.coins || 0) + reward
      };
      const updatedContracts = contracts.map(c => {
        if (c.id === contractId) return { ...c, claimed: true };
        return c;
      });
      setContracts(updatedContracts);
      updatedUser.contracts = updatedContracts;
      setCurrentUser(updatedUser);
      alert(`[遊客模式] 領取成功！獲得 ${reward} Delta 金幣！`);
    } else {
      try {
        const reward = contract.reward;
        const resultUser = claimContractReward(currentUser.username, contractId, reward);
        if (resultUser) {
          setCurrentUser(resultUser);
          setContracts(resultUser.contracts || []);
          alert(`領取成功！獲得 ${reward} Delta 金幣！`);
        }
      } catch (err) {
        alert(err.message);
      }
    }
  };

  // 神秘商人購入折價商品
  const handleBuySecretMerchantItem = (item) => {
    if (!currentUser) return;
    const currentCoins = currentUser.coins !== undefined ? currentUser.coins : 0;
    if (currentCoins < item.cost) {
      alert('Delta 金幣不足，神秘商人拒絕交易！');
      return;
    }

    if (currentUser.isGuest) {
      const updatedUser = { ...currentUser };
      if (!updatedUser.stash) {
        updatedUser.stash = { m4a1: 0, ak47: 0, awp: 0, mp5: 0, m870: 0, m9: 0, deagle: 0, bodyArmor: 0, opsHelmet: 0, grenade: 0, medkit: 0, goldBar: 0, hardDrive: 0, dogTag: 0, keycard: 0, flashbang: 0, smoke: 0, knife: 0 };
      }
      
      const [w, h] = getItemSize(item.id);
      const space = findEmptySpace(updatedUser.gridStashItems, w, h);
      if (!space) {
        alert('倉庫已滿，請先整理出空間！');
        return;
      }

      updatedUser.coins = currentCoins - item.cost;
      
      const itemObj = {
        uid: generateUid(),
        type: item.id,
        r: space.r,
        c: space.c
      };
      if (['m4a1', 'ak47', 'awp', 'mp5', 'm870', 'm9', 'deagle'].includes(item.id)) {
        itemObj.attachments = { sight: null, muzzle: null, grip: null, magazine: null };
      }
      updatedUser.gridStashItems.push(itemObj);
      
      Object.keys(updatedUser.stash).forEach(k => {
        updatedUser.stash[k] = 0;
      });
      updatedUser.gridStashItems.forEach(stashItem => {
        if (updatedUser.stash[stashItem.type] !== undefined) {
          updatedUser.stash[stashItem.type] += 1;
        } else {
          updatedUser.stash[stashItem.type] = 1;
        }
      });

      setCurrentUser(updatedUser);
      alert(`[遊客模式] 成功購入 ${item.name}！已存入倉庫。`);
    } else {
      try {
        const updated = buyMarketItem(currentUser.username, item.id, item.cost);
        setCurrentUser(updated);
        alert(`成功購入 ${item.name}！已存入倉庫。`);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  // 黑市購入物資
  const handleBuyMarketItem = (itemId) => {
    if (!currentUser) return;
    const price = MARKET_PRICES.buy[itemId];
    if (price === undefined) return;

    const currentCoins = currentUser.coins !== undefined ? currentUser.coins : 0;
    if (currentCoins < price) {
      alert('Delta 金幣不足，黑市拒絕交易！');
      return;
    }

    if (currentUser.isGuest) {
      const updatedUser = { ...currentUser };
      if (!updatedUser.stash) {
        updatedUser.stash = { m4a1: 0, ak47: 0, awp: 0, mp5: 0, m870: 0, m9: 0, deagle: 0, bodyArmor: 0, opsHelmet: 0, grenade: 0, medkit: 0, goldBar: 0, hardDrive: 0, dogTag: 0, keycard: 0, flashbang: 0, smoke: 0, knife: 0 };
      }
      updatedUser.coins = currentCoins - price;
      updatedUser.stash[itemId] = (updatedUser.stash[itemId] || 0) + 1;
      setCurrentUser(updatedUser);
    } else {
      try {
        const updated = buyMarketItem(currentUser.username, itemId, price);
        setCurrentUser(updated);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  // 黑市售出物資
  const handleSellMarketItem = (itemId) => {
    if (!currentUser) return;
    const value = MARKET_PRICES.sell[itemId];
    if (value === undefined) return;

    const stashCount = currentUser.stash ? (currentUser.stash[itemId] || 0) : 0;
    if (stashCount <= 0) {
      alert('倉庫中無此物品可供售出！');
      return;
    }

    if (currentUser.isGuest) {
      const updatedUser = { ...currentUser };
      updatedUser.stash[itemId] -= 1;
      updatedUser.coins = (updatedUser.coins !== undefined ? updatedUser.coins : 0) + value;
      setCurrentUser(updatedUser);
    } else {
      try {
        const updated = sellMarketItem(currentUser.username, itemId, value);
        setCurrentUser(updated);
      } catch (err) {
        alert(err.message);
      }
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
    const ambushMultiplier = isAmbushActive ? 2 : 1;
    const killsCoins = finalKills * 50 * ambushMultiplier;
    const victoryCoins = (victory ? 300 : 0) * ambushMultiplier;
    const headshotsCoins = runStatsRef.current.headshots * 20 * ambushMultiplier;
    const accuracyPct = runStatsRef.current.shotsFired > 0 ? (runStatsRef.current.shotsHit / runStatsRef.current.shotsFired) : 0;
    const accuracyCoins = Math.round(accuracyPct * 100) * ambushMultiplier;
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

    const bp = backpackRef.current;

    if (currentUser.isGuest) {
      // 遊客模式：也累積金幣（暫存於 State，登出消失）
      const updatedUser = {
        ...currentUser,
        coins: (currentUser.coins !== undefined ? currentUser.coins : 0) + totalCoins
      };
      
      if (victory) {
        if (!updatedUser.stash) {
          updatedUser.stash = { m4a1: 0, ak47: 0, awp: 0, mp5: 0, m870: 0, m9: 0, deagle: 0, bodyArmor: 0, opsHelmet: 0, grenade: 0, medkit: 0, goldBar: 0, hardDrive: 0, dogTag: 0, keycard: 0, flashbang: 0, smoke: 0, knife: 0 };
        }
        // 將背包網格道具移至倉庫網格
        backpackItems.forEach(bpItem => {
          const [w, h] = getItemSize(bpItem.type);
          const space = findEmptySpace(updatedUser.gridStashItems, w, h);
          if (space) {
            const itemObj = {
              uid: generateUid(),
              type: bpItem.type,
              r: space.r,
              c: space.c
            };
            if (['m4a1', 'ak47', 'awp', 'mp5', 'm870', 'm9', 'deagle'].includes(bpItem.type)) {
              itemObj.attachments = { sight: null, muzzle: null, grip: null, magazine: null };
            }
            updatedUser.gridStashItems.push(itemObj);
          }
        });
        updatedUser.coins = (updatedUser.coins || 0) + backpackCoins;
        
        // 同步為舊數量格式維持相容
        Object.keys(updatedUser.stash).forEach(k => {
          updatedUser.stash[k] = 0;
        });
        updatedUser.gridStashItems.forEach(item => {
          if (updatedUser.stash[item.type] !== undefined) {
            updatedUser.stash[item.type] += 1;
          } else {
            updatedUser.stash[item.type] = 1;
          }
        });
      } else {
        // 戰死懲罰：丟裝
        updatedUser.equipped = {
          primaryWeapon: null,
          primaryAttachments: { sight: null, muzzle: null, grip: null, magazine: null },
          secondaryWeapon: null,
          secondaryAttachments: { sight: null, muzzle: null, grip: null, magazine: null },
          bodyArmor: false,
          opsHelmet: false,
          grenades: 0,
          medkits: 0
        };
      }
      
      setCurrentUser(updatedUser);
      setEndgameStats({
        ...runStats,
        coinsEarnedDetails
      });
      return;
    }

    // 實體帳號：使用 saveMatchLoot 進行存檔、物資併入倉庫、死亡丢裝懲罰
    const bpItemsForSave = [
      ...backpackItems.map(item => ({ type: item.type })),
      { type: 'coins', count: backpackCoins + totalCoins }
    ];
    const resultUser = saveMatchLoot(currentUser.username, runStats, bpItemsForSave, victory);
    if (resultUser) {
      setCurrentUser(resultUser);
      setEndgameStats({
        ...runStats,
        coinsEarnedDetails
      });
      
      // 同步戰績至雲端
      setCloudSyncStatus('syncing');
      syncPlayerToCloud(currentUser.username, resultUser.nickname, resultUser.stats)
        .then(() => {
          setCloudSyncStatus('done');
          loadCloudLeaderboard();
        })
        .catch(err => {
          console.error(err);
          setCloudSyncStatus('error');
        });
    } else {
      setEndgameStats({
        ...runStats,
        coinsEarnedDetails
      });
    }

    // 隨機觸發神秘商人 (30% 機率)
    const hasMerchant = Math.random() < 0.3;
    if (hasMerchant) {
      setSecretMerchantActive(true);
      setSecretMerchantItems(generateSecretMerchantItems());
    } else {
      setSecretMerchantActive(false);
    }
  };

  // 成功撤離處理
  const handleExtractSuccess = () => {
    setExtractionState('extracted');
    soundManager.stopHelicopterSound();
    soundManager.stopAmbient();
    if (device === 'mobile') {
      setIsLocked(false);
    } else if (controlsRef.current) {
      controlsRef.current.unlock();
    }
    saveEndgameStats(true, eliminated); // 勝利，儲存戰績
    setGameState('victory');
    updateContractProgress('extract');
  };

  // 點擊「DEPLOY」按鈕進入遊戲並鎖定滑鼠
  const handleDeploy = () => {
    setEndgameStats(null);
    runStatsRef.current = { shotsFired: 0, shotsHit: 0, headshots: 0, startTime: Date.now() };
    
    // 重置波次、搜刮與背包狀態
    setCurrentWave(1);
    setWaveCountdown(0);
    setBackpackItems([]);
    setBackpackCoins(0);
    setIsLootModalOpen(false);
    setContainerLootItems([]);
    setContainerLootCoins(0);
    setLootedContainers({});
    setNearContainer(null);
    setIsLooting(false);
    setLootProgress(0);
    setLootPopup(null);
    setDamageIndicators([]);
    setExtractionActive(false);
    setExtractionState('idle');
    setExtractionCountdown(5.0);
    setIsPlayerInExtractionZone(false);

    const initialMedkits = currentUser?.equipped?.medkits !== undefined ? currentUser.equipped.medkits : 2;
    setMedkits(initialMedkits);
    
    // 套用戰術裝備升級
    const hasArmor = currentUser?.equipped?.bodyArmor;
    const equippedGrenades = currentUser?.equipped?.grenades !== undefined ? currentUser.equipped.grenades : 2;
    const initialFlashbangs = currentUser?.equipped?.flashbangs !== undefined ? currentUser.equipped.flashbangs : 2;
    const initialSmokes = currentUser?.equipped?.smokes !== undefined ? currentUser.equipped.smokes : 2;
    setHealth(hasArmor ? 150 : 100);
    setGrenades(equippedGrenades);
    setFlashbangs(initialFlashbangs);
    setSmokes(initialSmokes);
    setActiveThrowable('grenade');

    const primaryWeaponId = currentUser?.equipped?.primaryWeapon || null;
    const secondaryWeaponId = currentUser?.equipped?.secondaryWeapon || null;
    setPrimaryAmmo(primaryWeaponId ? (primaryConfig?.maxAmmo || 0) : 0);
    setSecondaryAmmo(secondaryWeaponId ? (secondaryConfig?.maxAmmo || 0) : 0);
    if (primaryWeaponId) {
      setActiveWeapon('primary');
    } else if (secondaryWeaponId) {
      setActiveWeapon('secondary');
    } else {
      setActiveWeapon('primary');
    }
    // 隨機判定精銳伏擊事件 (15% 機率)
    const isAmbush = Math.random() < 0.15;
    setIsAmbushActive(isAmbush);
    setIsAmbushAlertVisible(isAmbush);
    if (isAmbush) {
      addKillFeedEntry(`⚠️ 注意：偵測到敵軍精銳伏擊小隊！`, 'headshot');
      setTimeout(() => {
        setIsAmbushAlertVisible(false);
      }, 3500);
    }

    const diff = getDifficultyMultiplier();
    if (selectedMap === 'facility') {
      setFacilityZone(8);
      setAdminTeleportTrigger(0);
      const initialEvent = Math.random() < 0.25 ? ['blackout', 'fog', 'alert', 'warp', 'combat'][Math.floor(Math.random() * 5)] : 'normal';
      setFacilityEvent(initialEvent);
      triggerFacilityEvent(initialEvent, 8, addKillFeedEntry);
      const initialWave = getWaveForZone(8);
      let spawned = spawnWave(initialWave, diff, isAmbush, 'facility', initialEvent);
      if (initialEvent === 'combat') {
        spawned = [
          ...spawned,
          { id: 901, enemyType: ENEMY_TYPES.ASSAULT, hp: 150, maxHp: 150, position: new THREE.Vector3(-1.5, 0, 90), state: 'alive', isAlly: true },
          { id: 902, enemyType: ENEMY_TYPES.ASSAULT, hp: 150, maxHp: 150, position: new THREE.Vector3(1.5, 0, 85), state: 'alive', isAlly: true }
        ];
      }
      setEnemies(spawned);
    } else {
      setEnemies(spawnEnemies(false, diff, isAmbush, selectedMap));
    }

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

  const addGrenade = (position, velocity, type = 'grenade') => {
    const id = Math.random();
    setGrenadeEntities((prev) => [...prev, { id, position, velocity, type }]);
    if (isTutorial) triggerTutorialStep('grenade');
  };

  const addEnemyGrenade = (position, velocity, targetPos) => {
    const id = Math.random();
    setEnemyGrenadeEntities((prev) => [...prev, { id, position, velocity, targetPos }]);
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
  const handleExplodeGrenade = (id, explosionPoint, type = 'grenade') => {
    // 移除該手榴彈實體
    setGrenadeEntities((prev) => prev.filter((g) => g.id !== id));

    if (type === 'grenade') {
      // 1. HE 手榴彈爆炸：爆炸音效 + 火焰沙塵粒子 + 相機震動 + 範圍傷害
      soundManager.playExplosion();

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

      // 觸發鏡頭劇烈抖動
      setShakeTrigger((prev) => prev + 1);

      // 範圍傷害判定：敵軍與玩家
      setEnemies((prev) => {
        return prev.map((enemy) => {
          if (enemy.state === 'alive') {
            const dist = enemy.position.distanceTo(explosionPoint);
            if (dist < 8.0) {
              const damage = Math.max(0, Math.round(100 * (1 - dist / 8.0)));
              const newHp = Math.max(0, enemy.hp - damage);
              const isDead = newHp <= 0;
              if (isDead) {
                soundManager.playEnemyDeath();
                const enemyTypeName = enemy.enemyType ? enemy.enemyType.toUpperCase() : 'ENEMY';
                addKillFeedEntry(`PLAYER ➔ [GRENADE] ${enemyTypeName}_0${enemy.id}`, 'grenade');
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

      // 玩家自傷判定
      if (cameraRef.current) {
        const playerPos = cameraRef.current.position;
        const distToPlayer = playerPos.distanceTo(explosionPoint);
        if (distToPlayer < 6.0) {
          const damage = Math.max(0, Math.round(80 * (1 - distToPlayer / 6.0)));
          if (damage > 0) {
            setHealth((prev) => {
              const newHp = Math.max(0, prev - damage);
              if (newHp <= 0) {
                setGameState('failed');
                soundManager.stopAmbient();
                if (controlsRef.current) {
                  controlsRef.current.unlock();
                }
                saveEndgameStats(false);
              }
              return newHp;
            });
            setHurtActive(true);
            soundManager.playPlayerHurt();
          }
        }
      }
    } 
    else if (type === 'flashbang') {
      // 2. 戰術閃光彈爆炸：閃光音效 + 白色閃光粒子 + 玩家致盲點積判定 + 敵軍致盲 Stun
      soundManager.playFlashbangExplosion();

      const explosionParticles = [];
      for (let i = 0; i < 20; i++) {
        const pId = Math.random();
        const velocity = new THREE.Vector3(
          (Math.random() - 0.5) * 6.0,
          Math.random() * 5.0,
          (Math.random() - 0.5) * 6.0
        );
        explosionParticles.push({
          id: pId,
          position: explosionPoint.clone(),
          velocity,
          color: '#ffffff', // 純白閃光微粒
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
      }, 800);

      // 玩家致盲判定
      if (cameraRef.current) {
        const playerPos = cameraRef.current.position.clone();
        const dir = new THREE.Vector3();
        cameraRef.current.getWorldDirection(dir);
        const toFlash = explosionPoint.clone().sub(playerPos);
        const dist = toFlash.length();
        toFlash.normalize();
        const dot = dir.dot(toFlash);

        // 如果玩家正面面向閃光彈 (dot > -0.25) 且距離在 25 米內，或者距離在 8 米內（即使背對也會被強光散射影響）
        if (dist < 25.0 && (dot > -0.25 || dist < 8.0)) {
          // 點積越大、距離越近，閃光強度越強
          const distFactor = 1.0 - dist / 25.0;
          const angleFactor = dist < 8.0 ? 1.0 : (dot + 0.25) / 1.25;
          const finalIntensity = Math.min(1.0, Math.max(0.2, distFactor * angleFactor));
          setFlashIntensity(finalIntensity);
          flashIntensityRef.current = finalIntensity;
        }
      }

      // 敵軍致盲 Stun 判定 (半徑 18.0 米以內的敵軍均受致盲影響)
      setEnemies((prev) => {
        return prev.map((enemy) => {
          if (enemy.state === 'alive') {
            const dist = enemy.position.distanceTo(explosionPoint);
            if (dist < 18.0) {
              const enemyTypeName = enemy.enemyType ? enemy.enemyType.toUpperCase() : 'ENEMY';
              const enemyName = `${enemyTypeName}_0${enemy.id}`;
              addKillFeedEntry(`✨ ${enemyName} 被閃光彈致盲！`, 'system');
              return {
                ...enemy,
                stunnedTimer: 5.0, // 盲目 5 秒，無法開火或旋轉
              };
            }
          }
          return enemy;
        });
      });
    } 
    else if (type === 'smoke') {
      // 3. 戰術煙霧彈：氣體噴射音效 + 註冊局內煙霧雲物件
      soundManager.playSmokeHiss();

      const smokeId = Math.random();
      setSmokeClouds((prev) => [
        ...prev,
        { id: smokeId, position: explosionPoint.clone(), radius: 10.0, timeLeft: 12.0 }
      ]);
      addKillFeedEntry(`💨 煙霧彈已在戰區釋放，阻擋敵軍視線`, 'system');
    }
  };

  // 敵軍手榴彈倒數結束爆炸判定 (只傷害玩家，且新增對應的傷害方向指示器)
  const handleEnemyGrenadeExplode = (id, explosionPoint) => {
    // 1. 播放合成爆炸音效
    soundManager.playExplosion();

    // 2. 移除該敵方手榴彈實體
    setEnemyGrenadeEntities((prev) => prev.filter((g) => g.id !== id));

    // 3. 生成大範圍橘灰相間微粒
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
        color: Math.random() > 0.45 ? '#d97706' : '#6b7280',
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

    // 5. 範圍傷害判定：僅對玩家 (半徑 5.0 米，35 maxHP，隨距離衰減)
    if (gunRef.current) {
      const playerPos = gunRef.current.position;
      const distToPlayer = playerPos.distanceTo(explosionPoint);
      if (distToPlayer < 5.0) {
        const damage = Math.max(0, Math.round(35 * (1 - distToPlayer / 5.0)));
        if (damage > 0) {
          setHealth((prev) => {
            const newHp = Math.max(0, prev - damage);
            if (newHp <= 0) {
              setGameState('failed');
              soundManager.stopAmbient();
              if (controlsRef.current) {
                controlsRef.current.unlock();
              }
              saveEndgameStats(false);
            }
            return newHp;
          });
          setHurtActive(true);
          soundManager.playPlayerHurt();
          
          // 計算受擊方向指示器 (Grenade attackerPos = explosionPoint)
          if (cameraRef.current) {
            const fwd = new THREE.Vector3();
            cameraRef.current.getWorldDirection(fwd);
            fwd.y = 0;
            fwd.normalize();
            
            const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
            const playerPosClean = cameraRef.current.position.clone();
            playerPosClean.y = 0;
            
            const toExplosion = new THREE.Vector3(explosionPoint.x, 0, explosionPoint.z).sub(playerPosClean);
            toExplosion.y = 0;
            toExplosion.normalize();
            
            const fwdDot = toExplosion.dot(fwd);
            const rightDot = toExplosion.dot(right);
            
            const relativeAngle = Math.atan2(rightDot, fwdDot);
            const angleDeg = (relativeAngle * 180) / Math.PI;

            const newIndicator = {
              id: Math.random(),
              angle: angleDeg,
              attackerPos: explosionPoint.clone(),
              createdAt: Date.now()
            };
            setDamageIndicators((prev) => [...prev, newIndicator]);
          }
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

  // 取得動態難度係數 (Dynamic Difficulty Multiplier)
  const getDifficultyMultiplier = () => {
    let multiplier = 1.0;
    // 依玩家目前血量調整 (低血量敵軍削弱，維持邊界挑戰)
    if (health < 40) {
      multiplier -= 0.2;
    } else if (health < 70) {
      multiplier -= 0.1;
    }
    // 依玩家生涯戰績調整 (高手玩家難度提升，使其更有挑戰性)
    if (currentUser && currentUser.stats) {
      const totalScore = (currentUser.stats.kills * 100) + (currentUser.stats.wins * 500);
      if (totalScore > 8000) multiplier += 0.25;
      else if (totalScore > 4000) multiplier += 0.15;
      else if (totalScore > 1500) multiplier += 0.08;
    }
    return Math.max(0.6, Math.min(1.4, multiplier));
  };

  // 生成漂浮傷害數字 (Floating Damage Numbers)
  const addDamagePopup = (amount, position, isHeadshot) => {
    const id = Math.random().toString(36).substr(2, 9);
    setDamagePopups((prev) => [
      ...prev,
      { id, amount, position: position.clone(), isHeadshot, time: Date.now() }
    ]);
    setTimeout(() => {
      setDamagePopups((prev) => prev.filter((p) => p.id !== id));
    }, 800);
  };

  // 隨機生成神秘商人折價商品
  const generateSecretMerchantItems = () => {
    const pool = [
      { id: 'laserSight', name: 'M4A1 雷射瞄準器', cost: 480, originalCost: 800, desc: '40% 折扣！提升 M4A1 威力 (傷害由 25 ➔ 30)' },
      { id: 'suppressor', name: 'M9 戰術消音器', cost: 300, originalCost: 500, desc: '40% 折扣！提升 M9 威力 (傷害由 15 ➔ 20)' },
      { id: 'bodyArmor', name: '重型防彈衣', cost: 600, originalCost: 1000, desc: '40% 折扣！生命值上限提升至 150' },
      { id: 'opsHelmet', name: '特種作戰頭盔', cost: 720, originalCost: 1200, desc: '40% 折扣！降低受到頭部傷害 25%' },
      { id: 'awp', name: 'AWP 狙擊步槍', cost: 3000, originalCost: 5000, desc: '40% 特惠！超高傷害重型阻擊槍 (傷害 100 ➔ 300 爆頭)' }
    ];
    return pool.sort(() => 0.5 - Math.random()).slice(0, 3);
  };

  // 更新任務合約進度
  const updateContractProgress = (id, amount = 1) => {
    setContracts((prevContracts) => {
      const updated = prevContracts.map(c => {
        if (c.id === id && !c.done) {
          const newProgress = Math.min(c.target, c.progress + amount);
          return { ...c, progress: newProgress, done: newProgress >= c.target };
        }
        return c;
      });
      // 同步更新至 currentUser 物件以便自動存檔
      if (currentUser && !currentUser.isGuest) {
        currentUser.contracts = updated;
      }
      return updated;
    });
  };

  const handleShootEnemy = (attackerId, targetId, damage) => {
    setEnemies((prev) => {
      return prev.map((enemy) => {
        if (enemy.id === targetId && enemy.state === 'alive') {
          const newHp = Math.max(0, enemy.hp - damage);
          const isDead = newHp <= 0;
          
          if (isDead) {
            soundManager.playEnemyDeath();
            const attackerObj = prev.find(e => e.id === attackerId);
            const attackerName = attackerObj?.isAlly ? "DELTA 友軍" : `ENEMY_0${attackerId}`;
            const enemyTypeName = enemy.enemyType ? enemy.enemyType.toUpperCase() : 'ENEMY';
            const enemyName = enemy.isAlly ? "DELTA 友軍" : `${enemyTypeName}_0${enemy.id}`;
            addKillFeedEntry(`${attackerName} ➔ [SHOOT] ${enemyName}`, 'normal');
          }
          return {
            ...enemy,
            hp: newHp,
            state: isDead ? 'dying' : 'alive'
          };
        }
        return enemy;
      });
    });
  };

  // 擊中敵人時扣血與擊殺判定
  const handleHitEnemy = (enemyId, hitPoint, isHeadshot, enemyMesh = null) => {
    addImpactEffect(hitPoint, new THREE.Vector3(0, 1, 0));

    // 顯示命中反饋 (Hit Marker)
    triggerHitMarker(isHeadshot);

    // 如果是爆頭，播放專屬金屬敲擊聲
    if (isHeadshot) {
      soundManager.playHeadshotPing();
      if (isTutorial) triggerTutorialStep('headshot');
      updateContractProgress('headshots'); // 增加爆頭合約進度
    }

    if (isTutorial) triggerTutorialStep('shoot');

    setEnemies((prev) => {
      return prev.map((enemy) => {
        if (enemy.id === enemyId && enemy.state === 'alive') {
          const activeWeaponId = activeWeapon === 'primary' ? primaryWeaponId : secondaryWeaponId;
          const weaponConfig = WEAPON_CONFIGS[activeWeaponId] || WEAPON_CONFIGS.m4a1;
          
          const hasLaser = currentUser?.equipped?.laserSight || (currentUser && currentUser.inventory && currentUser.inventory.laserSight);
          const hasSuppressor = currentUser?.equipped?.suppressor || (currentUser && currentUser.inventory && currentUser.inventory.suppressor);
          
          let baseDamage = weaponConfig.damage;
          if (activeWeaponId === 'm4a1' && hasLaser) baseDamage = 30;
          if (activeWeaponId === 'm9' && hasSuppressor) baseDamage = 20;

          let damage = isHeadshot 
            ? Math.max(100, Math.round(baseDamage * 3)) 
            : baseDamage;

          // 盾兵正面減傷 60% 判定
          let isBlocked = false;
          if (enemy.enemyType === ENEMY_TYPES.SHIELD && enemyMesh) {
            // 取得敵人目前面向的角度並轉為方向向量
            const enemyRotY = enemyMesh.rotation.y;
            const enemyFacing = new THREE.Vector3(Math.sin(enemyRotY), 0, Math.cos(enemyRotY)).normalize();

            // 取得從敵人到玩家的向量
            const playerPosClean = cameraRef.current.position.clone();
            const toPlayer = new THREE.Vector3().subVectors(playerPosClean, enemyMesh.position);
            toPlayer.y = 0;
            toPlayer.normalize();

            // 夾角點積：如果 dot > 0.5 (即夾角小於 60°)，視為從正面擊中盾牌
            const dot = enemyFacing.dot(toPlayer);
            if (dot > 0.5) {
              isBlocked = true;
              damage = Math.round(damage * 0.4); // 減傷 60%
              
              // 觸發 HUD BLOCKED 特效與閃爍
              setShieldBlockActive(true);
              if (window.shieldBlockTimeout) clearTimeout(window.shieldBlockTimeout);
              window.shieldBlockTimeout = setTimeout(() => {
                setShieldBlockActive(false);
              }, 800);
            }
          }

          // 生成漂浮傷害數字
          addDamagePopup(damage, hitPoint, isHeadshot);

          const newHp = Math.max(0, enemy.hp - damage);
          const isDead = newHp <= 0;
          
          // 決定顯示在擊殺日誌的名字
          const enemyTypeName = enemy.enemyType ? enemy.enemyType.toUpperCase() : 'ENEMY';
          const enemyName = `${enemyTypeName}_0${enemy.id}`;

          if (isDead) {
            soundManager.playEnemyDeath(); // 播放倒地哀嚎聲
            // 寫入戰術擊殺訊息欄
            const weaponShortName = weaponConfig.name ? weaponConfig.name.split(' ')[0] : 'WEAPON';
            const killType = isHeadshot ? 'HEADSHOT' : weaponShortName;
            
            // 若為正面擊中但死於此槍，提示正面擊破
            const finalKillMsg = isBlocked ? `${killType} (BREAK)` : killType;
            addKillFeedEntry(`PLAYER ➔ [${finalKillMsg}] ${enemyName}`, isHeadshot ? 'headshot' : 'normal');

            // 增加擊殺合約進度
            updateContractProgress('kills');
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

    setEnemies((prev) => {
      const remaining = prev.filter((enemy) => enemy.id !== enemyId);
      if (remaining.length === 0) {
        if (selectedMap === 'facility') {
          if (facilityZone > 1) {
            addKillFeedEntry(`第 ${facilityZone} 出口區域的武裝分子已肅清！請前往長廊盡頭以進入下一區。`, 'headshot');
          } else {
            addKillFeedEntry('第 1 出口區域的武裝分子已肅清！鐵捲門已開啟，請走樓梯撤離出地鐵站！', 'headshot');
          }
        } else {
          if (currentWave < 3) {
            setWaveCountdown(5);
            addKillFeedEntry(`第 ${currentWave} 波已清除！下一波將在 5 秒後開始...`, 'system');
          } else {
            // Wave 3 cleared! Trigger helicopter evacuation
            setExtractionActive(true);
            setExtractionState('incoming');
            setExtractionCountdown(5.0);
            addKillFeedEntry('所有防守波次已痕跡！撤離直升機正在接近，趕往地圖中心 LZ 準備撤離！', 'system');
            soundManager.startHelicopterSound();
          }
        }
      }
      return remaining;
    });

    setEliminated((prev) => prev + 1);
  };

  // 敵軍定時向玩家開火扣血 (接受不同兵種的傷害值與攻擊來源座標)
  const handleShootPlayer = (damage = 10, attackerPos = null) => {
    if (gameState !== 'active') return;

    const hasHelmet = currentUser?.equipped?.opsHelmet || (currentUser && currentUser.inventory && currentUser.inventory.opsHelmet);
    
    // 套用動態難度
    const diff = getDifficultyMultiplier();
    const scaledDamage = Math.round(damage * diff);
    const finalDamage = hasHelmet ? Math.max(1, Math.round(scaledDamage * 0.75)) : scaledDamage;

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
    setShakeTrigger((prev) => prev + 1); // 觸發受擊鏡頭震動

    // 計算受擊方向指示器 (Directional Damage Indicator)
    if (attackerPos && cameraRef.current) {
      const fwd = new THREE.Vector3();
      cameraRef.current.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x); // 順時針旋轉 90 度
      
      const playerPos = cameraRef.current.position;
      const toAttacker = new THREE.Vector3().subVectors(attackerPos, playerPos);
      toAttacker.y = 0;
      toAttacker.normalize();
      
      const fwdDot = toAttacker.dot(fwd);
      const rightDot = toAttacker.dot(right);
      
      const relativeAngle = Math.atan2(rightDot, fwdDot);
      const angleDeg = (relativeAngle * 180) / Math.PI;

      const newIndicator = {
        id: Math.random(),
        angle: angleDeg,
        attackerPos: attackerPos.clone(),
        createdAt: Date.now()
      };
      setDamageIndicators((prev) => [...prev, newIndicator]);
    }
  };


  // 重新開始/部署遊戲
  const handleRestart = () => {
    setEndgameStats(null);
    runStatsRef.current = { shotsFired: 0, shotsHit: 0, headshots: 0, startTime: Date.now() };
    
    // 重置波次、搜刮與背包狀態
    setCurrentWave(1);
    setWaveCountdown(0);
    setBackpackItems([]);
    setBackpackCoins(0);
    setIsLootModalOpen(false);
    setContainerLootItems([]);
    setContainerLootCoins(0);
    setLootedContainers({});
    setNearContainer(null);
    setIsLooting(false);
    setLootProgress(0);
    setLootPopup(null);
    setDamageIndicators([]);
    setExtractionActive(false);
    setExtractionState('idle');
    setExtractionCountdown(5.0);
    setIsPlayerInExtractionZone(false);
    soundManager.stopHelicopterSound();

    const initialMedkits = currentUser?.equipped?.medkits !== undefined ? currentUser.equipped.medkits : 2;
    setMedkits(initialMedkits);

    // 套用戰術裝備升級
    const hasArmor = currentUser?.equipped?.bodyArmor;
    const equippedGrenades = currentUser?.equipped?.grenades !== undefined ? currentUser.equipped.grenades : 2;
    const initialFlashbangs = currentUser?.equipped?.flashbangs !== undefined ? currentUser.equipped.flashbangs : 2;
    const initialSmokes = currentUser?.equipped?.smokes !== undefined ? currentUser.equipped.smokes : 2;
    setHealth(hasArmor ? 150 : 100);
    setGrenades(equippedGrenades);
    setFlashbangs(initialFlashbangs);
    setSmokes(initialSmokes);
    setActiveThrowable('grenade');
    const primaryWeaponId = currentUser?.equipped?.primaryWeapon || null;
    const secondaryWeaponId = currentUser?.equipped?.secondaryWeapon || null;
    setPrimaryAmmo(primaryWeaponId ? (primaryConfig?.maxAmmo || 0) : 0);
    setSecondaryAmmo(secondaryWeaponId ? (secondaryConfig?.maxAmmo || 0) : 0);
    if (primaryWeaponId) {
      setActiveWeapon('primary');
    } else if (secondaryWeaponId) {
      setActiveWeapon('secondary');
    } else {
      setActiveWeapon('primary');
    }
    if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    setIsReloading(false);
    if (healTimeoutRef.current) clearTimeout(healTimeoutRef.current);
    if (healIntervalRef.current) clearInterval(healIntervalRef.current);
    setIsHealing(false);
    setHealProgress(0);
    setEliminated(0);
    setEnemies(spawnEnemies(isTutorial, 1.0, false, selectedMap)); // 依照當前是否為教學模式生成對應敵軍或標靶
    setHoles([]);
    setParticles([]);
    setIsAds(false);
    setPrimaryFireMode('auto');
    setGrenades(equippedGrenades);
    setGrenadeEntities([]);
    setEnemyGrenadeEntities([]);
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
    setEnemies(spawnEnemies(true, 1.0, false, selectedMap)); // 生成訓練標靶 Dummy
    setHoles([]);
    setParticles([]);
    setIsAds(false);
    setPrimaryFireMode('auto');
    setGrenades(2);
    setGrenadeEntities([]);
    setEnemyGrenadeEntities([]);
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
    
    // 重置波次、搜刮與背包狀態
    setCurrentWave(1);
    setWaveCountdown(0);
    setBackpackItems([]);
    setBackpackCoins(0);
    setIsLootModalOpen(false);
    setContainerLootItems([]);
    setContainerLootCoins(0);
    setLootedContainers({});
    setNearContainer(null);
    setIsLooting(false);
    setLootProgress(0);
    setLootPopup(null);
    setDamageIndicators([]);
    setExtractionActive(false);
    setExtractionState('idle');
    setExtractionCountdown(5.0);
    setIsPlayerInExtractionZone(false);
    
    const initialMedkits = currentUser?.equipped?.medkits !== undefined ? currentUser.equipped.medkits : 2;
    setMedkits(initialMedkits);

    // 重啟進入正式實戰模式
    const hasArmor = currentUser?.equipped?.bodyArmor;
    const equippedGrenades = currentUser?.equipped?.grenades !== undefined ? currentUser.equipped.grenades : 2;
    const initialFlashbangs = currentUser?.equipped?.flashbangs !== undefined ? currentUser.equipped.flashbangs : 2;
    const initialSmokes = currentUser?.equipped?.smokes !== undefined ? currentUser.equipped.smokes : 2;
    setHealth(hasArmor ? 150 : 100);
    setGrenades(equippedGrenades);
    setFlashbangs(initialFlashbangs);
    setSmokes(initialSmokes);
    setActiveThrowable('grenade');
    const primaryWeaponId = currentUser?.equipped?.primaryWeapon || null;
    const secondaryWeaponId = currentUser?.equipped?.secondaryWeapon || null;
    setPrimaryAmmo(primaryWeaponId ? (primaryConfig?.maxAmmo || 0) : 0);
    setSecondaryAmmo(secondaryWeaponId ? (secondaryConfig?.maxAmmo || 0) : 0);
    if (primaryWeaponId) {
      setActiveWeapon('primary');
    } else if (secondaryWeaponId) {
      setActiveWeapon('secondary');
    } else {
      setActiveWeapon('primary');
    }
    if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    setIsReloading(false);
    setEliminated(0);
    setEnemies(spawnEnemies(false, 1.0, false, selectedMap));
    setHoles([]);
    setParticles([]);
    setIsAds(false);
    setPrimaryFireMode('auto');
    setGrenades(equippedGrenades);
    setGrenadeEntities([]);
    setEnemyGrenadeEntities([]);
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

  const handleAdvanceFacilityZone = () => {
    setFacilityZone((prev) => {
      const nextZone = prev - 1;
      if (nextZone >= 1) {
        const diff = getDifficultyMultiplier();
        const nextWave = getWaveForZone(nextZone);
        
        // 隨機選擇本區事件
        const events = ['normal', 'normal', 'blackout', 'fog', 'alert', 'warp', 'combat'];
        const randomEvent = events[Math.floor(Math.random() * events.length)];
        setFacilityEvent(randomEvent);
        triggerFacilityEvent(randomEvent, nextZone, addKillFeedEntry);

        let spawned = spawnWave(nextWave, diff, isAmbushActive, 'facility', randomEvent);
        if (randomEvent === 'combat') {
          spawned = [
            ...spawned,
            { id: 901, enemyType: ENEMY_TYPES.ASSAULT, hp: 150, maxHp: 150, position: new THREE.Vector3(-1.5, 0, 90), state: 'alive', isAlly: true },
            { id: 902, enemyType: ENEMY_TYPES.ASSAULT, hp: 150, maxHp: 150, position: new THREE.Vector3(1.5, 0, 85), state: 'alive', isAlly: true }
          ];
        }
        setEnemies(spawned);

        setResetTrigger((prevTrig) => prevTrig + 1);
      }
      return nextZone;
    });
  };

  // 返回大廳 (回到初始畫面/大廳，並完整重置遊戲狀態)
  const handleReturnToLobby = () => {
    setEndgameStats(null);
    runStatsRef.current = { shotsFired: 0, shotsHit: 0, headshots: 0, startTime: Date.now() };
    
    // 重置波次、搜刮與背包狀態
    setCurrentWave(1);
    setFacilityZone(8);
    setAdminTeleportTrigger(0);
    setFacilityEvent('normal');
    setWaveCountdown(0);
    setBackpackItems([]);
    setBackpackCoins(0);
    setIsLootModalOpen(false);
    setContainerLootItems([]);
    setContainerLootCoins(0);
    setLootedContainers({});
    setNearContainer(null);
    setIsLooting(false);
    setLootProgress(0);
    setLootPopup(null);
    setDamageIndicators([]);
    setExtractionActive(false);
    setExtractionState('idle');
    setExtractionCountdown(5.0);
    setIsPlayerInExtractionZone(false);
    soundManager.stopHelicopterSound();

    if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    setIsReloading(false);
    if (healTimeoutRef.current) clearTimeout(healTimeoutRef.current);
    if (healIntervalRef.current) clearInterval(healIntervalRef.current);
    setIsHealing(false);
    setHealProgress(0);
    setEliminated(0);
    setEnemies([]);
    setHoles([]);
    setParticles([]);
    setIsAds(false);
    setPrimaryFireMode('auto');
    setGrenadeEntities([]);
    setEnemyGrenadeEntities([]);
    setCasings([]);
    setDroppedMags([]);
    setKillFeed([]);
    setAmmoCooldown(0);
    setResetTrigger((prev) => prev + 1);

    // 關閉 PointerLock
    setIsLocked(false);
    if (controlsRef.current) {
      controlsRef.current.unlock();
    }
    
    setIsTutorial(false);
    // 將狀態設回大廳
    setGameState('deploying');
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

  // 勝利或失敗狀態下，按 R 鍵返回大廳 (回到初始畫面)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyR') {
        if (gameState === 'victory' || gameState === 'failed') {
          handleReturnToLobby();
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

      {/* 受傷方向指示器 HUD */}
      {gameState === 'active' && damageIndicators.length > 0 && (
        <div className="damage-indicator-container">
          {damageIndicators.map((ind) => {
            const age = Date.now() - ind.createdAt;
            const opacity = Math.max(0, 1 - age / 1500);
            return (
              <div
                key={ind.id}
                className="damage-indicator-arrow"
                data-x={ind.attackerPos?.x}
                data-z={ind.attackerPos?.z}
                style={{
                  opacity: opacity,
                }}
              />
            );
          })}
        </div>
      )}

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
          {shieldBlockActive && (
            <div className="hud-blocked-feedback">
              <span className="blocked-icon">🛡️</span>
              <span className="blocked-text">BLOCKED</span>
            </div>
          )}
        </div>
      )}

      {/* 狙擊槍開鏡黑邊與瞄準圈 */}
      {isLocked && gameState === 'active' && isAds && activeWeaponId === 'awp' && (
        <div className="sniper-scope-overlay">
          <div className="scope-lens">
            <div className="scope-line-h" />
            <div className="scope-line-v" />
            <div className="scope-center-dot" />
          </div>
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
                    <div className="auth-tabs" style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                      <button 
                        type="button"
                        className={`auth-tab ${authTab === 'login' ? 'active' : ''}`}
                        onClick={() => { setAuthTab('login'); setAuthError(''); }}
                        style={{ flex: 1 }}
                      >
                        登入 LOGIN
                      </button>
                      <button 
                        type="button"
                        className={`auth-tab ${authTab === 'register' ? 'active' : ''}`}
                        onClick={() => { setAuthTab('register'); setAuthError(''); }}
                        style={{ flex: 1 }}
                      >
                        註冊 REGISTER
                      </button>
                      <button 
                        type="button"
                        className={`auth-tab ${authTab === 'gamekey' ? 'active' : ''}`}
                        onClick={() => { setAuthTab('gamekey'); setAuthError(''); }}
                        style={{ flex: 1 }}
                      >
                        金鑰登入 KEY
                      </button>
                    </div>

                    {authError && <div className="auth-error">{authError}</div>}

                    {authTab === 'login' && (
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
                    )}

                    {authTab === 'register' && (
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

                    {authTab === 'gamekey' && (
                      <form className="auth-form" onSubmit={handleGameKeyLogin}>
                        <div className="form-group">
                          <label>遊戲金鑰 GAME KEY</label>
                          <input 
                            type="text" 
                            name="gameKey" 
                            className="auth-input"
                            required
                            placeholder="請輸入遊戲金鑰"
                            value={authForm.gameKey || ''}
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
                            placeholder="請輸入帳號密碼"
                            value={authForm.password}
                            onChange={handleAuthInputChange}
                          />
                        </div>
                        <div className="form-group">
                          <label>動態驗證碼 2FA TOKEN</label>
                          <input 
                            type="text" 
                            name="otpToken" 
                            className="auth-input"
                            required
                            placeholder="輸入下方安全器生成的 6 位密碼"
                            value={authForm.otpToken || ''}
                            onChange={handleAuthInputChange}
                          />
                        </div>
                        <button type="submit" className="auth-submit-btn">雙重安全驗證 VERIFY & LOGIN</button>
                        
                        {/* 電子密碼安全器 Widget */}
                        <div className="authenticator-widget">
                          <div className="authenticator-title">🛡️ 電子密碼安全器 (SECURE TOKEN)</div>
                          <div className="authenticator-code">{currentOtp}</div>
                          <div className="authenticator-countdown">
                            <div className="countdown-bar" style={{ width: `${(otpCountdown / 30) * 100}%` }}></div>
                          </div>
                          <div className="authenticator-tip">請在下方倒數結束前輸入此 6 位驗證碼</div>
                        </div>
                      </form>
                    )}
                    <button 
                      type="button"
                      className="auth-guest-btn"
                      onClick={() => setCurrentUser({ 
                        username: 'Guest', 
                        nickname: 'GUEST_RECRUIT', 
                        isGuest: true,
                        coins: 500,
                        stash: {
                          m4a1: 0,
                          m9: 0,
                          bodyArmor: 0,
                          opsHelmet: 0,
                          grenade: 0,
                          medkit: 0,
                          goldBar: 0,
                          hardDrive: 0,
                          dogTag: 0
                        },
                        equipped: {
                          primaryWeapon: 'm4a1',
                          secondaryWeapon: 'm9',
                          bodyArmor: false,
                          opsHelmet: false,
                          grenades: 1,
                          medkits: 1
                        }
                      })}
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
                          {/* 地圖選擇器 MAP SELECTOR */}
                          <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                            <div style={{ fontSize: '0.85rem', color: 'var(--hud-primary)', letterSpacing: '1px', marginBottom: '8px', fontWeight: 'bold' }}>
                              SELECT OPERATIONS BATTLEFIELD / 選擇戰術場地:
                            </div>
                            <div style={{ display: 'flex', gap: '15px' }}>
                              <button 
                                className={`map-select-btn ${selectedMap === 'outpost' ? 'active' : ''}`}
                                onClick={() => setSelectedMap('outpost')}
                                style={{
                                  flex: 1,
                                  background: selectedMap === 'outpost' ? 'rgba(0, 255, 102, 0.15)' : 'rgba(0, 0, 0, 0.4)',
                                  border: selectedMap === 'outpost' ? '2px solid #00ff66' : '1px dashed rgba(0, 255, 102, 0.4)',
                                  color: selectedMap === 'outpost' ? '#00ff66' : 'rgba(0, 255, 102, 0.6)',
                                  padding: '10px 15px',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontFamily: 'monospace',
                                  fontSize: '0.85rem',
                                  textAlign: 'center',
                                  transition: 'all 0.2s ease',
                                  boxShadow: selectedMap === 'outpost' ? '0 0 10px rgba(0, 255, 102, 0.2)' : 'none',
                                  fontWeight: selectedMap === 'outpost' ? 'bold' : 'normal'
                                }}
                              >
                                前哨基地 OUTPOST BASE<br/>(荒野前哨 - 經典)
                              </button>
                              <button 
                                className={`map-select-btn ${selectedMap === 'facility' ? 'active' : ''}`}
                                onClick={() => setSelectedMap('facility')}
                                style={{
                                  flex: 1,
                                  background: selectedMap === 'facility' ? 'rgba(0, 229, 255, 0.15)' : 'rgba(0, 0, 0, 0.4)',
                                  border: selectedMap === 'facility' ? '2px solid #00e5ff' : '1px dashed rgba(0, 229, 255, 0.4)',
                                  color: selectedMap === 'facility' ? '#00e5ff' : 'rgba(0, 229, 255, 0.6)',
                                  padding: '10px 15px',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontFamily: 'monospace',
                                  fontSize: '0.85rem',
                                  textAlign: 'center',
                                  transition: 'all 0.2s ease',
                                  boxShadow: selectedMap === 'facility' ? '0 0 10px rgba(0, 229, 255, 0.2)' : 'none',
                                  fontWeight: selectedMap === 'facility' ? 'bold' : 'normal'
                                }}
                              >
                                地鐵通道 EXIT 8 SUBWAY<br/>(室內通道 - 近戰)
                              </button>
                            </div>
                          </div>

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
                          className={`lobby-tab-btn ${lobbyTab === 'loadout' ? 'active' : ''}`}
                          style={{
                            background: lobbyTab === 'loadout' ? 'rgba(0, 229, 255, 0.15)' : 'transparent',
                            color: lobbyTab === 'loadout' ? '#00e5ff' : '#88a888',
                            border: '1px solid',
                            borderColor: lobbyTab === 'loadout' ? '#00e5ff' : 'rgba(136, 168, 136, 0.3)',
                            padding: '6px 15px',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            borderRadius: '4px',
                            textShadow: lobbyTab === 'loadout' ? '0 0 5px rgba(0,229,255,0.5)' : 'none',
                            transition: 'all 0.2s',
                            fontWeight: 'bold'
                          }}
                          onClick={() => setLobbyTab('loadout')}
                        >
                          ⚔ 戰術配裝 LOADOUT
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
                          🛒 黑市商店 MARKET
                        </button>
                        {secretMerchantActive && (
                          <button
                            type="button"
                            className={`lobby-tab-btn secret-merchant-btn ${lobbyTab === 'merchant' ? 'active' : ''}`}
                            style={{
                              background: lobbyTab === 'merchant' ? 'rgba(224, 64, 251, 0.25)' : 'rgba(224, 64, 251, 0.1)',
                              color: '#fce4ff',
                              border: '1px solid #e040fb',
                              padding: '6px 15px',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              borderRadius: '4px',
                              textShadow: '0 0 5px rgba(224,64,251,0.5)',
                              transition: 'all 0.2s',
                              fontWeight: 'bold',
                              position: 'relative'
                            }}
                            onClick={() => setLobbyTab('merchant')}
                          >
                            🔮 祕密商人 MERCHANT
                            <span className="secret-merchant-badge">限時!</span>
                          </button>
                        )}
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
                          <div className="stats-tab-scroll" style={{ maxHeight: '420px', overflowY: 'auto', paddingRight: '8px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
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

                            {/* 任務合約系統 */}
                            <div className="contracts-section" style={{ marginTop: '20px', background: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(0, 255, 102, 0.15)', borderRadius: '6px', padding: '15px', textAlign: 'left' }}>
                              <h4 style={{ color: '#00ff66', margin: '0 0 12px 0', fontSize: '0.95rem', letterSpacing: '1px', borderBottom: '1px solid rgba(0, 255, 102, 0.2)', paddingBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>📝 特種作戰合約 CONTRACTS</span>
                                <span style={{ fontSize: '0.7rem', color: '#88a888', fontWeight: 'normal' }}>完成合約獲得 Delta 幣報酬</span>
                              </h4>
                              <div className="contracts-list" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                {contracts.map((c) => {
                                  const isCompleted = c.progress >= c.target;
                                  const progressPercent = Math.min(100, Math.round((c.progress / c.target) * 100));
                                  return (
                                    <div key={c.id} className="contract-card" style={{ background: 'rgba(0, 255, 102, 0.02)', border: '1px solid rgba(0, 255, 102, 0.08)', borderRadius: '4px', padding: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                      <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.8rem' }}>
                                          <span style={{ color: isCompleted ? '#00ff66' : '#fff', fontWeight: 'bold' }}>{c.desc}</span>
                                          <span style={{ color: '#ffcc00', fontWeight: 'bold' }}>💰 +{c.reward}</span>
                                        </div>
                                        <div className="contract-progress-container" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                          <div className="contract-progress-bar-bg" style={{ flex: 1, height: '6px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                                            <div className="contract-progress-bar-fill" style={{ width: `${progressPercent}%`, height: '100%', background: isCompleted ? '#00ff66' : '#00e5ff', borderRadius: '3px', transition: 'width 0.3s' }} />
                                          </div>
                                          <span style={{ fontSize: '0.7rem', color: '#88a888', minWidth: '35px', textAlign: 'right' }}>{c.progress}/{c.target}</span>
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                                        {c.claimed ? (
                                          <span style={{ fontSize: '0.7rem', color: '#88a888', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '3px' }}>✓ 已領取報酬</span>
                                        ) : isCompleted ? (
                                          <button
                                            type="button"
                                            className="claim-reward-btn"
                                            style={{
                                              background: '#00ff66',
                                              color: '#000',
                                              border: 'none',
                                              padding: '3px 10px',
                                              borderRadius: '3px',
                                              fontSize: '0.7rem',
                                              fontWeight: 'bold',
                                              cursor: 'pointer',
                                              boxShadow: '0 0 8px rgba(0,255,102,0.4)',
                                              transition: 'all 0.2s'
                                            }}
                                            onClick={() => handleClaimContractReward(c.id)}
                                          >
                                            領取 {c.reward} 幣
                                          </button>
                                        ) : (
                                          <span style={{ fontSize: '0.7rem', color: '#88a888' }}>執行中...</span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* 排行榜區塊 */}
                            <div className="leaderboard-section">
                              <div className="leaderboard-tabs">
                                <button 
                                  className={`leaderboard-tab-btn ${leaderboardType === 'global' ? 'active' : ''}`}
                                  onClick={() => {
                                    setLeaderboardType('global');
                                    loadCloudLeaderboard();
                                  }}
                                >
                                  全球雲端排行 (GLOBAL)
                                </button>
                                <button 
                                  className={`leaderboard-tab-btn ${leaderboardType === 'local' ? 'active' : ''}`}
                                  onClick={() => setLeaderboardType('local')}
                                >
                                  本機特種排行 (LOCAL)
                                </button>

                                {isCloudLoading ? (
                                  <span className="leaderboard-status-indicator syncing">
                                    載入中<span className="leaderboard-loading-dots"></span>
                                  </span>
                                ) : cloudSyncStatus === 'syncing' ? (
                                  <span className="leaderboard-status-indicator syncing">
                                    同步中<span className="leaderboard-loading-dots"></span>
                                  </span>
                                ) : cloudSyncStatus === 'done' ? (
                                  <span className="leaderboard-status-indicator" style={{ color: '#00ff66', borderColor: 'rgba(0,255,102,0.3)' }}>
                                    ✓ 已同步
                                  </span>
                                ) : cloudSyncStatus === 'error' ? (
                                  <span className="leaderboard-status-indicator error" onClick={loadCloudLeaderboard} style={{ cursor: 'pointer' }}>
                                    ⚠ 同步失敗 (點擊重試)
                                  </span>
                                ) : leaderboardType === 'global' ? (
                                  <button className="leaderboard-refresh-btn" onClick={loadCloudLeaderboard}>
                                    ↻ 整理
                                  </button>
                                ) : null}
                              </div>

                              {cloudError && leaderboardType === 'global' && (
                                <div style={{ color: '#ff3b3b', fontSize: '0.65rem', marginBottom: '8px', textAlign: 'center', letterSpacing: '0.5px' }}>
                                  {cloudError}
                                </div>
                              )}

                              <div className="leaderboard-wrapper">
                                {leaderboardType === 'global' && isCloudLoading && cloudLeaderboard.length === 0 ? (
                                  <div className="leaderboard-loading">
                                    載入雲端排行中<span className="leaderboard-loading-dots"></span>
                                  </div>
                                ) : leaderboardType === 'global' && cloudLeaderboard.length === 0 ? (
                                  <div className="leaderboard-loading" style={{ color: '#88a888' }}>
                                    目前尚無雲端排行紀錄
                                  </div>
                                ) : (
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
                                      {leaderboardType === 'global' ? (
                                        cloudLeaderboard.map((player, index) => (
                                          <tr key={player.username} className={player.username === currentUser.username ? 'current-user' : ''}>
                                            <td className="leaderboard-rank">#{index + 1}</td>
                                            <td>{player.nickname}</td>
                                            <td>{getRank(player.kills).zhTitle}</td>
                                            <td>{player.kills}</td>
                                            <td>{player.wins}</td>
                                            <td>{player.totalScore}</td>
                                          </tr>
                                        ))
                                      ) : (
                                        leaderboard.map((player, index) => (
                                          <tr key={player.username} className={player.username === currentUser.username ? 'current-user' : ''}>
                                            <td className="leaderboard-rank">#{index + 1}</td>
                                            <td>{player.nickname}</td>
                                            <td>{getRank(player.kills).zhTitle}</td>
                                            <td>{player.kills}</td>
                                            <td>{player.wins}</td>
                                            <td>{player.totalScore}</td>
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      ) : lobbyTab === 'loadout' ? (
                        <div className="loadout-container" style={{ display: 'flex', gap: '20px', flex: 1, maxHeight: '420px', overflow: 'hidden', position: 'relative' }}>
                          {/* 左側：單兵配置 Equipped Loadout */}
                          <div className="loadout-column equipped-list" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', paddingRight: '5px' }}>
                            <h5 style={{ color: '#00e5ff', margin: '0 0 5px 0', borderBottom: '1px solid rgba(0,229,255,0.2)', paddingBottom: '4px', letterSpacing: '1px', fontSize: '0.85rem', textAlign: 'left' }}>
                              單兵配裝 LOADOUT (可拖曳裝備/卸下)
                            </h5>
                            
                            {/* Slot 1: Primary Weapon */}
                            <div 
                              className={`loadout-slot-card ${activeHoverSlot === 'primaryWeapon' ? 'compatible-hover' : ''}`} 
                              style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(0,229,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s', cursor: currentUser.equipped?.primaryWeapon ? 'grab' : 'default' }}
                              onDragOver={(e) => { if (isCompatibleWithSlot('primaryWeapon')) e.preventDefault(); }}
                              onDragEnter={() => { if (isCompatibleWithSlot('primaryWeapon')) setActiveHoverSlot('primaryWeapon'); }}
                              onDragLeave={() => setActiveHoverSlot(null)}
                              onDrop={() => { handleDropOnSlot('primaryWeapon'); setActiveHoverSlot(null); }}
                              draggable={!!currentUser.equipped?.primaryWeapon}
                              onDragStart={(e) => {
                                if (currentUser.equipped?.primaryWeapon) {
                                  handleDragStart(e, { type: currentUser.equipped.primaryWeapon }, 'loadout', 'primaryWeapon');
                                }
                              }}
                              onContextMenu={(e) => {
                                if (currentUser.equipped?.primaryWeapon) {
                                  handleItemContextMenu(e, { type: currentUser.equipped.primaryWeapon }, 'loadout', 'primaryWeapon');
                                }
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                {currentUser.equipped?.primaryWeapon && (
                                  <div style={{
                                    width: '64px',
                                    height: '36px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'rgba(0, 229, 255, 0.05)',
                                    border: '1px solid rgba(0, 229, 255, 0.3)',
                                    borderRadius: '3px',
                                    overflow: 'hidden',
                                    padding: '0px',
                                  }}>
                                    <img 
                                      src={`weapons/${currentUser.equipped.primaryWeapon}.png`} 
                                      alt={currentUser.equipped.primaryWeapon}
                                      style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'contain',
                                        filter: 'drop-shadow(0 0 3px rgba(0, 229, 255, 0.4))'
                                      }}
                                    />
                                  </div>
                                )}
                                <div style={{ textAlign: 'left' }}>
                                  <div style={{ fontSize: '0.65rem', color: '#88a888' }}>主武器 PRIMARY WEAPON ⚔️</div>
                                  <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#fff' }}>
                                    {ITEM_NAMES[currentUser.equipped?.primaryWeapon] || '無空缺 (拖曳武器至此)'}
                                  </div>
                                </div>
                              </div>
                              {currentUser.equipped?.primaryWeapon && (
                                <button className="loadout-action-btn sell-btn" style={{ fontSize: '0.7rem', padding: '4px 8px', border: '1px solid #ff3b3b', color: '#ff3b3b', background: 'transparent', cursor: 'pointer', borderRadius: '3px' }} onClick={() => handleUnequip('primaryWeapon')}>
                                  卸下
                                </button>
                              )}
                            </div>
 
                            {/* Slot 2: Secondary Weapon */}
                            <div 
                              className={`loadout-slot-card ${activeHoverSlot === 'secondaryWeapon' ? 'compatible-hover' : ''}`}
                              style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(0,229,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s', cursor: currentUser.equipped?.secondaryWeapon ? 'grab' : 'default' }}
                              onDragOver={(e) => { if (isCompatibleWithSlot('secondaryWeapon')) e.preventDefault(); }}
                              onDragEnter={() => { if (isCompatibleWithSlot('secondaryWeapon')) setActiveHoverSlot('secondaryWeapon'); }}
                              onDragLeave={() => setActiveHoverSlot(null)}
                              onDrop={() => { handleDropOnSlot('secondaryWeapon'); setActiveHoverSlot(null); }}
                              draggable={!!currentUser.equipped?.secondaryWeapon}
                              onDragStart={(e) => {
                                if (currentUser.equipped?.secondaryWeapon) {
                                  handleDragStart(e, { type: currentUser.equipped.secondaryWeapon }, 'loadout', 'secondaryWeapon');
                                }
                              }}
                              onContextMenu={(e) => {
                                if (currentUser.equipped?.secondaryWeapon) {
                                  handleItemContextMenu(e, { type: currentUser.equipped.secondaryWeapon }, 'loadout', 'secondaryWeapon');
                                }
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                {currentUser.equipped?.secondaryWeapon && (
                                  <div style={{
                                    width: '64px',
                                    height: '36px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'rgba(0, 229, 255, 0.05)',
                                    border: '1px solid rgba(0, 229, 255, 0.3)',
                                    borderRadius: '3px',
                                    overflow: 'hidden',
                                    padding: '0px',
                                  }}>
                                    <img 
                                      src={`weapons/${currentUser.equipped.secondaryWeapon}.png`} 
                                      alt={currentUser.equipped.secondaryWeapon}
                                      style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'contain',
                                        filter: 'drop-shadow(0 0 3px rgba(0, 229, 255, 0.4))'
                                      }}
                                    />
                                  </div>
                                )}
                                <div style={{ textAlign: 'left' }}>
                                  <div style={{ fontSize: '0.65rem', color: '#88a888' }}>副武器 SECONDARY WEAPON 🔫</div>
                                  <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#fff' }}>
                                    {ITEM_NAMES[currentUser.equipped?.secondaryWeapon] || '無空缺 (拖曳手槍至此)'}
                                  </div>
                                </div>
                              </div>
                              {currentUser.equipped?.secondaryWeapon && (
                                <button className="loadout-action-btn sell-btn" style={{ fontSize: '0.7rem', padding: '4px 8px', border: '1px solid #ff3b3b', color: '#ff3b3b', background: 'transparent', cursor: 'pointer', borderRadius: '3px' }} onClick={() => handleUnequip('secondaryWeapon')}>
                                  卸下
                                </button>
                              )}
                            </div>
 
                            {/* Slot 3: Body Armor */}
                            <div 
                              className={`loadout-slot-card ${activeHoverSlot === 'bodyArmor' ? 'compatible-hover' : ''}`}
                              style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(0,229,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s', cursor: currentUser.equipped?.bodyArmor ? 'grab' : 'default' }}
                              onDragOver={(e) => { if (isCompatibleWithSlot('bodyArmor')) e.preventDefault(); }}
                              onDragEnter={() => { if (isCompatibleWithSlot('bodyArmor')) setActiveHoverSlot('bodyArmor'); }}
                              onDragLeave={() => setActiveHoverSlot(null)}
                              onDrop={() => { handleDropOnSlot('bodyArmor'); setActiveHoverSlot(null); }}
                              draggable={!!currentUser.equipped?.bodyArmor}
                              onDragStart={(e) => {
                                if (currentUser.equipped?.bodyArmor) {
                                  handleDragStart(e, { type: 'bodyArmor' }, 'loadout', 'bodyArmor');
                                }
                              }}
                              onContextMenu={(e) => {
                                if (currentUser.equipped?.bodyArmor) {
                                  handleItemContextMenu(e, { type: 'bodyArmor' }, 'loadout', 'bodyArmor');
                                }
                              }}
                            >
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ fontSize: '0.65rem', color: '#88a888' }}>防彈護甲 BODY ARMOR (+50 HP) 🛡️</div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: currentUser.equipped?.bodyArmor ? '#00ff66' : '#88a888' }}>
                                  {currentUser.equipped?.bodyArmor ? '重型防彈衣 (Equipped)' : '未穿戴 (拖曳防彈衣至此)'}
                                </div>
                              </div>
                              {currentUser.equipped?.bodyArmor && (
                                <button className="loadout-action-btn sell-btn" style={{ fontSize: '0.7rem', padding: '4px 8px', border: '1px solid #ff3b3b', color: '#ff3b3b', background: 'transparent', cursor: 'pointer', borderRadius: '3px' }} onClick={() => handleUnequip('bodyArmor')}>
                                  卸下
                                </button>
                              )}
                            </div>
 
                            {/* Slot 4: Ops Helmet */}
                            <div 
                              className={`loadout-slot-card ${activeHoverSlot === 'opsHelmet' ? 'compatible-hover' : ''}`}
                              style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(0,229,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s', cursor: currentUser.equipped?.opsHelmet ? 'grab' : 'default' }}
                              onDragOver={(e) => { if (isCompatibleWithSlot('opsHelmet')) e.preventDefault(); }}
                              onDragEnter={() => { if (isCompatibleWithSlot('opsHelmet')) setActiveHoverSlot('opsHelmet'); }}
                              onDragLeave={() => setActiveHoverSlot(null)}
                              onDrop={() => { handleDropOnSlot('opsHelmet'); setActiveHoverSlot(null); }}
                              draggable={!!currentUser.equipped?.opsHelmet}
                              onDragStart={(e) => {
                                if (currentUser.equipped?.opsHelmet) {
                                  handleDragStart(e, { type: 'opsHelmet' }, 'loadout', 'opsHelmet');
                                }
                              }}
                              onContextMenu={(e) => {
                                if (currentUser.equipped?.opsHelmet) {
                                  handleItemContextMenu(e, { type: 'opsHelmet' }, 'loadout', 'opsHelmet');
                                }
                              }}
                            >
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ fontSize: '0.65rem', color: '#88a888' }}>特種頭盔 HELMET (減傷 25%) 🪖</div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: currentUser.equipped?.opsHelmet ? '#00ff66' : '#88a888' }}>
                                  {currentUser.equipped?.opsHelmet ? '特種作戰頭盔 (Equipped)' : '未穿戴 (拖曳頭盔至此)'}
                                </div>
                              </div>
                              {currentUser.equipped?.opsHelmet && (
                                <button className="loadout-action-btn sell-btn" style={{ fontSize: '0.7rem', padding: '4px 8px', border: '1px solid #ff3b3b', color: '#ff3b3b', background: 'transparent', cursor: 'pointer', borderRadius: '3px' }} onClick={() => handleUnequip('opsHelmet')}>
                                  卸下
                                </button>
                              )}
                            </div>
 
                            {/* Slot 4b: Laser Sight */}
                            <div 
                              className={`loadout-slot-card ${activeHoverSlot === 'laserSight' ? 'compatible-hover' : ''}`}
                              style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(0,229,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s', cursor: currentUser.equipped?.laserSight ? 'grab' : 'default' }}
                              onDragOver={(e) => { if (isCompatibleWithSlot('laserSight')) e.preventDefault(); }}
                              onDragEnter={() => { if (isCompatibleWithSlot('laserSight')) setActiveHoverSlot('laserSight'); }}
                              onDragLeave={() => setActiveHoverSlot(null)}
                              onDrop={() => { handleDropOnSlot('laserSight'); setActiveHoverSlot(null); }}
                              draggable={!!currentUser.equipped?.laserSight}
                              onDragStart={(e) => {
                                if (currentUser.equipped?.laserSight) {
                                  handleDragStart(e, { type: 'laserSight' }, 'loadout', 'laserSight');
                                }
                              }}
                              onContextMenu={(e) => {
                                if (currentUser.equipped?.laserSight) {
                                  handleItemContextMenu(e, { type: 'laserSight' }, 'loadout', 'laserSight');
                                }
                              }}
                            >
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ fontSize: '0.65rem', color: '#88a888' }}>M4A1 雷射瞄準器 (+5 傷害) 🔦</div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: currentUser.equipped?.laserSight ? '#00ff66' : '#88a888' }}>
                                  {currentUser.equipped?.laserSight ? '已安裝 (Equipped)' : '未安裝 (拖曳雷射至此)'}
                                </div>
                              </div>
                              {currentUser.equipped?.laserSight && (
                                <button className="loadout-action-btn sell-btn" style={{ fontSize: '0.7rem', padding: '4px 8px', border: '1px solid #ff3b3b', color: '#ff3b3b', background: 'transparent', cursor: 'pointer', borderRadius: '3px' }} onClick={() => handleUnequip('laserSight')}>
                                  卸下
                                </button>
                              )}
                            </div>
 
                            {/* Slot 4c: Suppressor */}
                            <div 
                              className={`loadout-slot-card ${activeHoverSlot === 'suppressor' ? 'compatible-hover' : ''}`}
                              style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(0,229,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s', cursor: currentUser.equipped?.suppressor ? 'grab' : 'default' }}
                              onDragOver={(e) => { if (isCompatibleWithSlot('suppressor')) e.preventDefault(); }}
                              onDragEnter={() => { if (isCompatibleWithSlot('suppressor')) setActiveHoverSlot('suppressor'); }}
                              onDragLeave={() => setActiveHoverSlot(null)}
                              onDrop={() => { handleDropOnSlot('suppressor'); setActiveHoverSlot(null); }}
                              draggable={!!currentUser.equipped?.suppressor}
                              onDragStart={(e) => {
                                if (currentUser.equipped?.suppressor) {
                                  handleDragStart(e, { type: 'suppressor' }, 'loadout', 'suppressor');
                                }
                              }}
                              onContextMenu={(e) => {
                                if (currentUser.equipped?.suppressor) {
                                  handleItemContextMenu(e, { type: 'suppressor' }, 'loadout', 'suppressor');
                                }
                              }}
                            >
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ fontSize: '0.65rem', color: '#88a888' }}>M9 戰術消音器 (+5 傷害) 🔇</div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: currentUser.equipped?.suppressor ? '#00ff66' : '#88a888' }}>
                                  {currentUser.equipped?.suppressor ? '已安裝 (Equipped)' : '未安裝 (拖曳消音器至此)'}
                                </div>
                              </div>
                              {currentUser.equipped?.suppressor && (
                                <button className="loadout-action-btn sell-btn" style={{ fontSize: '0.7rem', padding: '4px 8px', border: '1px solid #ff3b3b', color: '#ff3b3b', background: 'transparent', cursor: 'pointer', borderRadius: '3px' }} onClick={() => handleUnequip('suppressor')}>
                                  卸下
                                </button>
                              )}
                            </div>
 
                            {/* Slot 5: Grenades */}
                            <div 
                              className={`loadout-slot-card ${activeHoverSlot === 'grenades' ? 'compatible-hover' : ''}`}
                              style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(0,229,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s' }}
                              onDragOver={(e) => { if (isCompatibleWithSlot('grenades')) e.preventDefault(); }}
                              onDragEnter={() => { if (isCompatibleWithSlot('grenades')) setActiveHoverSlot('grenades'); }}
                              onDragLeave={() => setActiveHoverSlot(null)}
                              onDrop={() => { handleDropOnSlot('grenades'); setActiveHoverSlot(null); }}
                            >
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ fontSize: '0.65rem', color: '#88a888' }}>戰術手榴彈 GRENADES 💣</div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#fff' }}>
                                  {currentUser.equipped?.grenades || 0} 顆
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '5px' }}>
                                <button className="loadout-action-btn" style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid #00ff66', color: '#00ff66', background: 'transparent', cursor: 'pointer', borderRadius: '3px' }} onClick={() => handleEquip('grenades')}>
                                  +
                                </button>
                                <button className="loadout-action-btn" style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid #ff3b3b', color: '#ff3b3b', background: 'transparent', cursor: 'pointer', borderRadius: '3px' }} onClick={() => handleUnequip('grenades')}>
                                  -
                                </button>
                              </div>
                            </div>
 
                            {/* Slot 6: Medkits */}
                            <div 
                              className={`loadout-slot-card ${activeHoverSlot === 'medkits' ? 'compatible-hover' : ''}`}
                              style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(0,229,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s' }}
                              onDragOver={(e) => { if (isCompatibleWithSlot('medkits')) e.preventDefault(); }}
                              onDragEnter={() => { if (isCompatibleWithSlot('medkits')) setActiveHoverSlot('medkits'); }}
                              onDragLeave={() => setActiveHoverSlot(null)}
                              onDrop={() => { handleDropOnSlot('medkits'); setActiveHoverSlot(null); }}
                            >
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ fontSize: '0.65rem', color: '#88a888' }}>戰地醫療包 MEDKITS 🩹</div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#fff' }}>
                                  {currentUser.equipped?.medkits || 0} 個
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '5px' }}>
                                <button className="loadout-action-btn" style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid #00ff66', color: '#00ff66', background: 'transparent', cursor: 'pointer', borderRadius: '3px' }} onClick={() => handleEquip('medkits')}>
                                  +
                                </button>
                                <button className="loadout-action-btn" style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid #ff3b3b', color: '#ff3b3b', background: 'transparent', cursor: 'pointer', borderRadius: '3px' }} onClick={() => handleUnequip('medkits')}>
                                  -
                                </button>
                              </div>
                            </div>
                          </div>
                          
                          {/* 右側：個人倉庫 Stash */}
                          <div className="loadout-column stash-list" style={{ flex: 1.2, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,204,0,0.2)', paddingBottom: '4px', marginBottom: '5px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <h5 style={{ color: '#ffcc00', margin: 0, letterSpacing: '1px', fontSize: '0.85rem', textAlign: 'left' }}>
                                  個人倉庫 STASH
                                </h5>
                                <button 
                                  onClick={handleSortStash}
                                  style={{
                                    fontSize: '0.62rem',
                                    padding: '2px 6px',
                                    border: '1px solid #ffcc00',
                                    color: '#ffcc00',
                                    background: 'rgba(255, 204, 0, 0.1)',
                                    cursor: 'pointer',
                                    borderRadius: '3px',
                                    fontWeight: 'bold',
                                    transition: 'all 0.2s',
                                  }}
                                  onMouseEnter={(e) => { e.target.style.background = 'rgba(255, 204, 0, 0.25)'; }}
                                  onMouseLeave={(e) => { e.target.style.background = 'rgba(255, 204, 0, 0.1)'; }}
                                >
                                  一鍵整理 SORT ⚡
                                </button>
                              </div>
                              <span style={{ fontSize: '0.62rem', color: '#88a888' }}>拖曳移動 | 按 [R] 旋轉</span>
                            </div>
                            
                            {/* Stash Grid Viewport */}
                            {(() => {
                              // 動態計算網格最大行數，以防物品超出時無法顯示
                              const gridRows = Math.max(12, ...((currentUser.gridStashItems || []).map(item => {
                                const [, h] = getItemSize(item.type, item);
                                return item.r + h;
                              })), 0) + 4;
                              
                              const contextMenuItemStyle = {
                                padding: '8px 14px',
                                cursor: 'pointer',
                                color: '#fff',
                                fontSize: '0.72rem',
                                textAlign: 'left',
                                transition: 'all 0.2s',
                                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                              };
                              
                              return (
                                <div className="stash-grid-viewport" style={{ flex: 1, overflowY: 'auto', maxHeight: '380px', paddingRight: '5px', position: 'relative' }}>
                                  <div className="stash-grid-container" style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(10, 36px)',
                                    gridTemplateRows: `repeat(${gridRows}, 36px)`,
                                    width: '362px',
                                    height: `${gridRows * 36 + 2}px`,
                                    position: 'relative',
                                    background: 'rgba(0, 0, 0, 0.45)',
                                    border: '1px solid rgba(255, 204, 0, 0.15)',
                                    backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
                                    backgroundSize: '36px 36px',
                                    padding: 0,
                                    margin: 0,
                                    maxHeight: 'none',
                                    overflow: 'visible',
                                  }}>
                                    {/* Grid Cells (Drop targets) */}
                                    {Array.from({ length: gridRows * 10 }).map((_, idx) => {
                                      const r = Math.floor(idx / 10);
                                      const c = idx % 10;
                                      return (
                                        <div
                                          key={`cell-${r}-${c}`}
                                          style={{
                                            width: '36px',
                                            height: '36px',
                                            boxSizing: 'border-box',
                                          }}
                                          onDragOver={(e) => {
                                            e.preventDefault();
                                            if (dragOverCell?.r !== r || dragOverCell?.c !== c) {
                                              setDragOverCell({ r, c });
                                            }
                                          }}
                                          onDrop={(e) => handleDropOnGrid(e, r, c)}
                                        />
                                      );
                                    })}
                                    
                                    {/* Drag & Drop Preview Highlight */}
                                    {draggedItem && dragOverCell && (
                                      (() => {
                                        const fits = checkDragFits(draggedItem, dragOverCell.r, dragOverCell.c, draggedItemRotated);
                                        const [baseW, baseH] = getItemSize(draggedItem.type);
                                        const w = draggedItemRotated ? baseH : baseW;
                                        const h = draggedItemRotated ? baseW : baseH;
                                        return (
                                          <div style={{
                                            position: 'absolute',
                                            left: `${dragOverCell.c * 36}px`,
                                            top: `${dragOverCell.r * 36}px`,
                                            width: `${w * 36}px`,
                                            height: `${h * 36}px`,
                                            background: fits ? 'rgba(0, 255, 102, 0.22)' : 'rgba(255, 59, 59, 0.22)',
                                            border: `1px solid ${fits ? '#00ff66' : '#ff3b3b'}`,
                                            boxShadow: `inset 0 0 8px ${fits ? 'rgba(0, 255, 102, 0.4)' : 'rgba(255, 59, 59, 0.4)'}`,
                                            pointerEvents: 'none',
                                            zIndex: 10,
                                            borderRadius: '3px',
                                          }} />
                                        );
                                      })()
                                    )}
                                    
                                    {/* Grid Stash Items */}
                                    {(currentUser.gridStashItems || []).map((item) => {
                                      const [w, h] = getItemSize(item.type, item);
                                      const isWeapon = ['m4a1', 'ak47', 'awp', 'mp5', 'm870', 'm9', 'deagle'].includes(item.type);
                                      let categoryColor = '#88a888';
                                      let categoryBg = 'rgba(255, 255, 255, 0.03)';
                                      let itemIcon = '📦';
                                      
                                      if (['m4a1', 'ak47', 'awp', 'mp5', 'm870'].includes(item.type)) {
                                        categoryColor = '#00e5ff';
                                        categoryBg = 'rgba(0, 229, 255, 0.08)';
                                        itemIcon = '🔫';
                                      } else if (['m9', 'deagle'].includes(item.type)) {
                                        categoryColor = '#00e5ff';
                                        categoryBg = 'rgba(0, 229, 255, 0.08)';
                                        itemIcon = '🔫';
                                      } else if (['bodyArmor', 'opsHelmet'].includes(item.type)) {
                                        categoryColor = '#00ff66';
                                        categoryBg = 'rgba(0, 255, 102, 0.08)';
                                        itemIcon = '🛡️';
                                      } else if (['grenade', 'medkit', 'flashbang', 'smoke'].includes(item.type)) {
                                        categoryColor = '#ffaa00';
                                        categoryBg = 'rgba(255, 170, 0, 0.08)';
                                        itemIcon = '💊';
                                      } else if (['goldBar', 'hardDrive', 'dogTag', 'keycard'].includes(item.type)) {
                                        categoryColor = '#ffd700';
                                        categoryBg = 'rgba(255, 215, 0, 0.08)';
                                        itemIcon = '🪙';
                                      } else if (item.type.startsWith('sight_') || item.type.startsWith('muzzle_') || item.type.startsWith('grip_') || item.type.startsWith('mag_')) {
                                        categoryColor = '#b0bec5';
                                        categoryBg = 'rgba(176, 190, 197, 0.08)';
                                        itemIcon = '🔧';
                                      }
                                      
                                      const isVertical = h > w;
                                      
                                      return (
                                        <div
                                          key={item.uid}
                                          style={{
                                            position: 'absolute',
                                            left: `${item.c * 36}px`,
                                            top: `${item.r * 36}px`,
                                            width: `${w * 36 - 2}px`,
                                            height: `${h * 36 - 2}px`,
                                            margin: '1px',
                                            boxSizing: 'border-box',
                                            background: categoryBg,
                                            border: `1px solid ${categoryColor}`,
                                            borderRadius: '3px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                            cursor: 'grab',
                                            userSelect: 'none',
                                            pointerEvents: (draggedItem && draggedItem.uid !== item.uid) ? 'none' : 'auto',
                                            transition: 'box-shadow 0.15s, border-color 0.15s',
                                            zIndex: 2,
                                            overflow: (isWeapon && item.rotated) ? 'visible' : 'hidden',
                                            padding: isWeapon ? '0px' : '2px',
                                          }}
                                          title={`${ITEM_NAMES[item.type] || item.type} (右鍵選單 / 雙擊裝備)`}
                                          draggable
                                          onDragStart={(e) => handleDragStart(e, item, 'stash')}
                                          onDoubleClick={() => handleItemDoubleClick(item)}
                                          onContextMenu={(e) => handleItemContextMenu(e, item, 'stash')}
                                        >
                                          {isWeapon ? (
                                            <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: (isWeapon && item.rotated) ? 'visible' : 'hidden' }}>
                                              <img 
                                                src={`weapons/${item.type}.png`} 
                                                alt={item.type}
                                                style={{
                                                  width: item.rotated ? `${h * 36 - 4}px` : '100%',
                                                  height: item.rotated ? `${w * 36 - 4}px` : '100%',
                                                  objectFit: 'contain',
                                                  transform: item.rotated ? 'rotate(90deg)' : 'none',
                                                  filter: 'drop-shadow(0 0 5px rgba(0, 229, 255, 0.45))',
                                                  pointerEvents: 'none',
                                                }}
                                              />
                                              <span style={{
                                                position: 'absolute',
                                                bottom: '3px',
                                                left: '3px',
                                                fontSize: '0.52rem',
                                                fontWeight: 'bold',
                                                color: '#fff',
                                                background: 'rgba(5, 12, 8, 0.75)',
                                                padding: '1px 4px',
                                                borderRadius: '2px',
                                                border: '1px solid rgba(0, 229, 255, 0.3)',
                                                pointerEvents: 'none',
                                                zIndex: 3,
                                                letterSpacing: '0.5px',
                                                textShadow: '0 0 2px #000',
                                              }}>
                                                {ITEM_NAMES[item.type] ? ITEM_NAMES[item.type].split(' ')[0] : item.type}
                                              </span>
                                            </div>
                                          ) : (
                                            <div style={{
                                              display: 'flex',
                                              flexDirection: isVertical ? 'column' : 'row',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              gap: '2px',
                                              width: '100%',
                                              height: '100%',
                                              writingMode: isVertical ? 'vertical-rl' : 'horizontal-tb',
                                              textOrientation: 'mixed',
                                            }}>
                                              <span style={{ fontSize: '0.9rem' }}>{itemIcon}</span>
                                              <span style={{
                                                fontSize: '0.62rem',
                                                fontWeight: 'bold',
                                                color: '#fff',
                                                textAlign: 'center',
                                                lineHeight: 1.1,
                                                whiteSpace: 'nowrap',
                                              }}>
                                                {ITEM_NAMES[item.type] ? ITEM_NAMES[item.type].split(' ')[0] : item.type}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  
                                  {/* Right-click Context Menu */}
                                  {activeContextMenu && (
                                    <div
                                      style={{
                                        position: 'fixed',
                                        left: `${activeContextMenu.x}px`,
                                        top: `${activeContextMenu.y}px`,
                                        background: 'rgba(10, 20, 15, 0.95)',
                                        border: '1px solid #ffcc00',
                                        borderRadius: '3px',
                                        boxShadow: '0 0 15px rgba(255, 204, 0, 0.35)',
                                        zIndex: 9999,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        padding: '4px 0',
                                        minWidth: '110px',
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {activeContextMenu.from === 'stash' ? (
                                        <>
                                          {/* Auto equip option */}
                                          {['m4a1', 'ak47', 'awp', 'mp5', 'm870'].includes(activeContextMenu.type) && (
                                            <div
                                              className="context-menu-item"
                                              style={contextMenuItemStyle}
                                              onClick={() => { handleEquip('primaryWeapon', activeContextMenu.itemUid); setActiveContextMenu(null); }}
                                            >
                                              裝備至主武器
                                            </div>
                                          )}
                                          {['m9', 'deagle'].includes(activeContextMenu.type) && (
                                            <div
                                              className="context-menu-item"
                                              style={contextMenuItemStyle}
                                              onClick={() => { handleEquip('secondaryWeapon', activeContextMenu.itemUid); setActiveContextMenu(null); }}
                                            >
                                              裝備至副武器
                                            </div>
                                          )}
                                          {['bodyArmor', 'opsHelmet', 'laserSight', 'suppressor'].includes(activeContextMenu.type) && (
                                            <div
                                              className="context-menu-item"
                                              style={contextMenuItemStyle}
                                              onClick={() => { handleEquip(activeContextMenu.type, activeContextMenu.itemUid); setActiveContextMenu(null); }}
                                            >
                                              穿戴/裝備
                                            </div>
                                          )}
                                          {['grenade', 'medkit'].includes(activeContextMenu.type) && (
                                            <div
                                              className="context-menu-item"
                                              style={contextMenuItemStyle}
                                              onClick={() => { handleEquip(activeContextMenu.type === 'grenade' ? 'grenades' : 'medkits', activeContextMenu.itemUid); setActiveContextMenu(null); }}
                                            >
                                              放入配裝
                                            </div>
                                          )}
                                          {/* Rotate */}
                                          <div
                                            className="context-menu-item"
                                            style={contextMenuItemStyle}
                                            onClick={() => {
                                              try {
                                                if (currentUser.isGuest) {
                                                  setCurrentUser(guestRotateGridItem(currentUser, activeContextMenu.itemUid));
                                                } else {
                                                  const updated = rotateGridItem(currentUser.username, activeContextMenu.itemUid);
                                                  setCurrentUser(updated);
                                                }
                                              } catch (err) {
                                                alert(err.message);
                                              }
                                              setActiveContextMenu(null);
                                            }}
                                          >
                                            旋轉物品 (R)
                                          </div>
                                          {/* Sell */}
                                          <div
                                            className="context-menu-item"
                                            style={{ ...contextMenuItemStyle, color: '#ff3b3b', borderBottom: 'none' }}
                                            onClick={() => {
                                              const value = MARKET_PRICES.sell[activeContextMenu.type] || 0;
                                              if (confirm(`確認出售 ${ITEM_NAMES[activeContextMenu.type]} 獲得 ${value} 🪙 嗎？`)) {
                                                try {
                                                  if (currentUser.isGuest) {
                                                    const updated = { ...currentUser };
                                                    updated.gridStashItems = updated.gridStashItems.map(i => ({ ...i }));
                                                    const idx = updated.gridStashItems.findIndex(i => i.uid === activeContextMenu.itemUid);
                                                    if (idx > -1) {
                                                      updated.gridStashItems.splice(idx, 1);
                                                      updated.coins = (updated.coins || 0) + value;
                                                      syncGuestStashQuantities(updated);
                                                      setCurrentUser(updated);
                                                    }
                                                  } else {
                                                    const updated = sellMarketItemByUid(currentUser.username, activeContextMenu.itemUid, value);
                                                    setCurrentUser(updated);
                                                  }
                                                } catch (err) {
                                                  alert(err.message);
                                                }
                                              }
                                              setActiveContextMenu(null);
                                            }}
                                          >
                                            出售物品
                                          </div>
                                        </>
                                      ) : (
                                        <div
                                          className="context-menu-item"
                                          style={{ ...contextMenuItemStyle, borderBottom: 'none' }}
                                          onClick={() => { handleUnequip(activeContextMenu.slot); setActiveContextMenu(null); }}
                                        >
                                          卸下裝備
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      ) : lobbyTab === 'merchant' ? (
                        /* 神秘商人分頁 */
                        <div className="market-container secret-merchant-panel" style={{ display: 'flex', flexDirection: 'column', gap: '15px', flex: 1, maxHeight: '420px', overflow: 'hidden', background: 'rgba(224, 64, 251, 0.03)', border: '1px solid rgba(224, 64, 251, 0.15)', borderRadius: '6px', padding: '15px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(224, 64, 251, 0.25)', paddingBottom: '8px' }}>
                            <h5 style={{ color: '#fce4ff', margin: 0, letterSpacing: '1px', fontSize: '0.9rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>🔮 祕密商人限時特供 SECRET MERCHANT</span>
                            </h5>
                            <span style={{ fontSize: '0.7rem', color: '#e040fb', background: 'rgba(224, 64, 251, 0.15)', padding: '2px 8px', borderRadius: '3px', border: '1px solid rgba(224, 64, 251, 0.3)', fontWeight: 'bold' }}>限時折扣：所有商品 40% 折扣 (6 折)！</span>
                          </div>
                          
                          <div className="merchant-items-grid" style={{ display: 'flex', gap: '15px', flex: 1, overflowY: 'auto', padding: '5px 0' }}>
                            {secretMerchantItems.map((item) => (
                              <div key={item.id} className="market-item-card merchant-card" style={{ flex: 1, background: 'rgba(0, 0, 0, 0.5)', border: '1px solid rgba(224, 64, 251, 0.2)', borderRadius: '4px', padding: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', transition: 'all 0.2s' }}>
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#fff' }}>{item.name}</span>
                                    <span style={{ fontSize: '0.65rem', background: 'rgba(224,64,251,0.2)', color: '#ff80ab', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>特惠</span>
                                  </div>
                                  <p style={{ fontSize: '0.7rem', color: '#b0bec5', margin: '0 0 12px 0', textAlign: 'left', lineHeight: '1.3' }}>
                                    {item.desc}
                                  </p>
                                </div>
                                
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
                                    <span style={{ fontSize: '1rem', fontWeight: 'bold', color: '#ffcc00' }}>💰 {item.cost}</span>
                                    <span style={{ fontSize: '0.7rem', textDecoration: 'line-through', color: '#88a888' }}>{item.originalCost}</span>
                                  </div>
                                  <button
                                    type="button"
                                    style={{
                                      width: '100%',
                                      background: 'linear-gradient(135deg, #e040fb 0%, #aa00ff 100%)',
                                      color: '#fff',
                                      border: 'none',
                                      padding: '8px 12px',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      fontWeight: 'bold',
                                      cursor: 'pointer',
                                      boxShadow: '0 0 10px rgba(224,64,251,0.4)',
                                      transition: 'all 0.2s'
                                    }}
                                    onClick={() => handleBuySecretMerchantItem(item)}
                                  >
                                    立即購入
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        /* 黑市商店分頁 */
                        <div className="market-container" style={{ display: 'flex', gap: '20px', flex: 1, maxHeight: '420px', overflow: 'hidden' }}>
                          {/* 左側：黑市採購 Buy Panel */}
                          <div className="market-column buy-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <h5 style={{ color: '#ffcc00', margin: '0 0 5px 0', borderBottom: '1px solid rgba(255,204,0,0.2)', paddingBottom: '4px', letterSpacing: '1px', fontSize: '0.85rem', textAlign: 'left' }}>
                              黑市物資採購 BUY GEAR
                            </h5>
                            <div className="market-items-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '380px', paddingRight: '5px' }}>
                              {Object.keys(MARKET_PRICES.buy).map((itemId) => {
                                const cost = MARKET_PRICES.buy[itemId];
                                const descriptions = {
                                  m4a1: 'M4A1 突擊步槍 - 主力全自動武器，威力強大',
                                  m9: 'M9 戰術手槍 - 輕便好用的副手防身武器',
                                  bodyArmor: '重型防彈衣 - 出擊生命上限 +50 點防護',
                                  opsHelmet: '特種作戰頭盔 - 頭部減傷 25%，防爆頭',
                                  grenade: '戰術手榴彈 - 高爆物理破片，大範圍傷害',
                                  medkit: '戰地醫療包 - 局內受傷時可按 [5] 鍵包紮治療'
                                };
                                return (
                                  <div 
                                    key={itemId} 
                                    className="market-item-card buy-card"
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      background: 'rgba(255, 255, 255, 0.02)',
                                      border: '1px solid rgba(255, 204, 0, 0.1)',
                                      borderRadius: '4px',
                                      padding: '10px 12px',
                                      fontSize: '0.8rem',
                                      textAlign: 'left'
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, marginRight: '10px' }}>
                                      {['m4a1', 'ak47', 'awp', 'mp5', 'm870', 'm9', 'deagle'].includes(itemId) && (
                                        <div style={{
                                          width: '40px',
                                          height: '24px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          background: 'rgba(255, 204, 0, 0.05)',
                                          border: '1px solid rgba(255, 204, 0, 0.3)',
                                          borderRadius: '3px',
                                          overflow: 'hidden',
                                          padding: '1px',
                                        }}>
                                          <img 
                                            src={`weapons/${itemId}.png`} 
                                            alt={itemId}
                                            style={{
                                              width: '100%',
                                              height: '100%',
                                              objectFit: 'contain',
                                              filter: 'drop-shadow(0 0 3px rgba(255, 204, 0, 0.5))'
                                            }}
                                          />
                                        </div>
                                      )}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <span style={{ fontWeight: 'bold', color: '#fff' }}>{ITEM_NAMES[itemId]}</span>
                                        <span style={{ fontSize: '0.68rem', color: '#a0b0a0' }}>{descriptions[itemId] || ''}</span>
                                      </div>
                                    </div>
                                    <button 
                                      className="loadout-action-btn"
                                      style={{
                                        fontSize: '0.7rem',
                                        padding: '5px 10px',
                                        border: '1px solid #ffcc00',
                                        color: '#ffcc00',
                                        background: 'transparent',
                                        cursor: 'pointer',
                                        borderRadius: '3px',
                                        whiteSpace: 'nowrap'
                                      }}
                                      onClick={() => handleBuyMarketItem(itemId)}
                                    >
                                      購買 {cost} 🪙
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* 右側：回收物資 Sell Panel */}
                          <div className="market-column sell-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <h5 style={{ color: '#00ff66', margin: '0 0 5px 0', borderBottom: '1px solid rgba(0,255,102,0.2)', paddingBottom: '4px', letterSpacing: '1px', fontSize: '0.85rem', textAlign: 'left' }}>
                              黑市物資回收 SELL STASH
                            </h5>
                            <div className="market-items-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '380px', paddingRight: '5px' }}>
                              {Object.keys(currentUser.stash || {}).filter(key => (currentUser.stash[key] || 0) > 0).length === 0 ? (
                                <div style={{ color: '#88a888', fontSize: '0.8rem', padding: '30px 10px', textAlign: 'center' }}>
                                  ⚠️ 倉庫目前沒有任何可回收的物資
                                </div>
                              ) : (
                                Object.keys(currentUser.stash || {}).map((itemId) => {
                                  const count = currentUser.stash[itemId] || 0;
                                  if (count <= 0) return null;
                                  const value = MARKET_PRICES.sell[itemId] || 0;
                                  return (
                                    <div 
                                      key={itemId} 
                                      className="market-item-card sell-card"
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        background: 'rgba(0, 255, 102, 0.02)',
                                        border: '1px solid rgba(0, 255, 102, 0.1)',
                                        borderRadius: '4px',
                                        padding: '10px 12px',
                                        fontSize: '0.8rem',
                                        textAlign: 'left'
                                      }}
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, marginRight: '15px' }}>
                                        {['m4a1', 'ak47', 'awp', 'mp5', 'm870', 'm9', 'deagle'].includes(itemId) && (
                                          <div style={{
                                            width: '40px',
                                            height: '24px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: 'rgba(0, 255, 102, 0.05)',
                                            border: '1px solid rgba(0, 255, 102, 0.3)',
                                            borderRadius: '3px',
                                            overflow: 'hidden',
                                            padding: '1px',
                                          }}>
                                            <img 
                                              src={`weapons/${itemId}.png`} 
                                              alt={itemId}
                                              style={{
                                                width: '100%',
                                                height: '100%',
                                                objectFit: 'contain',
                                                filter: 'drop-shadow(0 0 3px rgba(0, 255, 102, 0.5))'
                                              }}
                                            />
                                          </div>
                                        )}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', flex: 1 }}>
                                          <span style={{ fontWeight: 'bold', color: '#fff' }}>{ITEM_NAMES[itemId]}</span>
                                          <span style={{ color: '#00ff66', fontWeight: 'bold' }}>x{count}</span>
                                        </div>
                                      </div>
                                      <button 
                                        className="loadout-action-btn"
                                        style={{
                                          fontSize: '0.7rem',
                                          padding: '5px 10px',
                                          border: '1px solid #00ff66',
                                          color: '#00ff66',
                                          background: 'transparent',
                                          cursor: 'pointer',
                                          borderRadius: '3px',
                                          whiteSpace: 'nowrap'
                                        }}
                                        onClick={() => handleSellMarketItem(itemId)}
                                      >
                                        出售 +{value} 🪙
                                      </button>
                                    </div>
                                  );
                                })
                              )}
                            </div>
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
                <button 
                  className="deploy-button" 
                  onClick={() => {
                    if (device === 'mobile') {
                      setIsLocked(true);
                    } else if (controlsRef.current) {
                      controlsRef.current.lock();
                    }
                  }}
                >
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

                <button className="deploy-button" onClick={handleReturnToLobby} style={{ marginTop: '15px' }}>
                  RETURN TO LOBBY 返回大廳 {device === 'pc' ? '(R)' : ''}
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

                <button className="deploy-button" onClick={handleReturnToLobby} style={{ marginTop: '15px' }}>
                  RETURN TO LOBBY 返回大廳 {device === 'pc' ? '(R)' : ''}
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
              style={{ fontSize: '1.8rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
              💥
            </div>
            
            {/* 跳躍 */}
            <div 
              className="mobile-btn btn-jump"
              onTouchStart={() => { mobileKeysRef.current.jump = true }}
              onTouchEnd={() => { mobileKeysRef.current.jump = false }}
              style={{ fontSize: '1.4rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
              ⏫
            </div>
            
            {/* 開鏡瞄準 ADS */}
            <div 
              className={`mobile-btn btn-ads ${isAds ? 'active' : ''}`}
              onClick={() => setIsAds((prev) => !prev)}
              style={{ fontSize: '1.3rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
              🎯
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
              style={{ fontSize: '1.3rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
              🧎
            </div>

            {/* 換彈 */}
            <div className="mobile-btn btn-reload" onClick={triggerReload} style={{ fontSize: '1.3rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              🔄
            </div>

            {/* 切槍 */}
            <div className="mobile-btn btn-switch" onClick={triggerWeaponSwitch} style={{ fontSize: '1.3rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              🔫
            </div>

            {/* 手榴彈 */}
            <div className="mobile-btn btn-grenade" onClick={() => setMobileGrenadeTrigger((prev) => prev + 1)} style={{ fontSize: '1.3rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              💣
            </div>

            {/* 補血 */}
            <div className="mobile-btn btn-heal" onClick={triggerHeal} style={{ fontSize: '1.3rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              💊
            </div>

            {/* 搜刮按鈕 (僅在靠近物資箱時顯現) */}
            {nearContainer && (
              <div 
                className="mobile-btn btn-search"
                onTouchStart={() => startLooting()}
                onTouchEnd={() => stopLooting()}
                onTouchCancel={() => stopLooting()}
                style={{ fontSize: '1.3rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
              >
                📦
              </div>
            )}
          </div>

          {/* 暫停 */}
          <button 
            className="mobile-pause-btn"
            onClick={() => setIsLocked(false)}
            style={{ fontSize: '1.2rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
          >
            ⏸
          </button>
        </div>
      )}

      {/* 2.2 遊戲 HUD 狀態疊加層 (僅在遊戲開始後顯示) */}
      {gameState !== 'deploying' && (
        <div className="game-hud">
          <div className="hud-top">
            <div className="hud-radar-scanner" id="radar-minimap">
              {/* 玩家中心點指標 */}
              <div className="radar-player-center">
                <div className="radar-player-arrow" />
              </div>
              {/* 動態渲染的敵軍與戰術目標點容器 */}
              <div className="radar-dots-container" id="radar-dots" />
            </div>
            <div className="hud-compass">N 024°</div>
            <div className="hud-mission-info">
              <h3>{selectedMap === 'facility' ? 'EXIT 8 ESCAPE' : 'TRAINING OP'}</h3>
              {isTutorial ? (
                <div>TARGETS ELIMINATED: <span style={{ color: '#00ff66', fontWeight: 'bold' }}>{eliminated}</span></div>
              ) : selectedMap === 'facility' ? (
                <div>當前出口: <span style={{ color: '#00ff66', fontWeight: 'bold' }}>出口 {facilityZone}</span> | 剩餘敵軍: <span style={{ color: '#00ff66', fontWeight: 'bold' }}>{enemies.filter(e => e.state === 'alive').length}</span></div>
              ) : (
                <div>WAVE: <span style={{ color: '#00ff66', fontWeight: 'bold' }}>{currentWave} / 3</span> | ENEMIES: <span style={{ color: '#00ff66', fontWeight: 'bold' }}>{enemies.filter(e => e.state === 'alive').length}</span></div>
              )}
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
                ) : weaponConfig ? (
                  <>
                    <span className="hud-large-num" style={{ color: ammo <= Math.ceil(weaponConfig.maxAmmo * 0.2) ? '#ffaa00' : 'inherit' }}>
                      {ammo}
                    </span>
                    <span className="hud-small-label">/ {weaponConfig.maxAmmo} {device === 'pc' ? '(R)' : ''}</span>
                  </>
                ) : (
                  <span className="hud-large-num" style={{ color: '#888' }}>
                    0 / 0
                  </span>
                )}
              </div>
              <div className="hud-sys-status" style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span>WEAPON: <span className="sys-active" style={{ color: weaponConfig ? '#00ff66' : '#888', fontWeight: 'bold' }}>{weaponConfig ? weaponConfig.name : 'UNARMED'}</span> {weaponConfig && <span style={{ color: ammo === 0 ? '#ffaa00' : '#88a888', fontSize: '0.8rem' }}>({ammo === 0 ? 'EMPTY' : 'READY'})</span>}</span>
                <span 
                  onClick={device === 'mobile' && weaponConfig ? triggerFireMode : undefined} 
                  style={{ cursor: device === 'mobile' && weaponConfig ? 'pointer' : 'default', userSelect: 'none' }}
                >
                  MODE: <span style={{ color: weaponConfig ? '#00ff66' : '#888', fontWeight: 'bold' }}>{weaponConfig ? (fireMode === 'auto' ? (activeWeapon === 'primary' ? primaryFireMode : 'semi') : 'semi') : 'N/A'}{weaponConfig && device === 'pc' ? ' [B]' : weaponConfig && device === 'mobile' ? ' ⇦' : ''}</span>
                </span>
              </div>
            </div>

            <div className="hud-status-card">
              <div className="hud-label">TACTICAL EQ</div>
              <div className="hud-status-row">
                <span className="hud-large-num" style={{ 
                  color: (activeThrowable === 'grenade' && grenades === 0) || 
                         (activeThrowable === 'flashbang' && flashbangs === 0) || 
                         (activeThrowable === 'smoke' && smokes === 0) ? '#ffaa00' : 'inherit' 
                }}>
                  {activeThrowable === 'grenade' ? grenades : activeThrowable === 'flashbang' ? flashbangs : smokes}
                </span>
                <span className="hud-small-label">/ 2 {device === 'pc' ? '(G)' : ''}</span>
              </div>
              <div className="hud-sys-status" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div>TYPE: <span style={{ color: '#00ff66', fontWeight: 'bold' }}>
                  {activeThrowable === 'grenade' ? '💣 HE GREN' : activeThrowable === 'flashbang' ? '✨ FLASH' : '💨 SMOKE'}
                </span></div>
                <div style={{ fontSize: '0.72rem', color: '#88a888' }}>
                  {device === 'pc' ? 'PRESS [4] TO CYCLE' : 'TAP GND TO THROW'}
                </div>
              </div>
            </div>

            <div className="hud-status-card">
              <div className="hud-label">MEDICAL SUPPLY</div>
              <div className="hud-status-row">
                <span className="hud-large-num" style={{ color: medkits === 0 ? '#ffaa00' : 'inherit' }}>
                  {medkits}
                </span>
                <span className="hud-small-label">/ {currentUser?.equipped?.medkits !== undefined ? currentUser.equipped.medkits : 2} {device === 'pc' ? '(5)' : ''}</span>
              </div>
              <div className="hud-sys-status">
                MEDKIT: <span className="sys-active" style={{ color: medkits === 0 ? '#ffaa00' : '#00ff66' }}>{medkits === 0 ? 'DEPLETED' : 'READY'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 搜刮進度條 HUD */}
      {isLooting && (
        <div className="hud-looting-overlay">
          <div className="hud-looting-label">SEARCHING CONTAINER...</div>
          <div className="hud-looting-bar-container">
            <div className="hud-looting-bar" style={{ width: `${lootProgress}%` }} />
          </div>
          <div className="hud-looting-pct">{Math.round(lootProgress)}%</div>
        </div>
      )}

      {/* 搜刮獲得物資 Popup HUD */}
      {lootPopup && (
        <div className="loot-popup-container">
          <div className="loot-popup-header">{lootPopup.title}</div>
          <div className="loot-popup-content">{lootPopup.content}</div>
        </div>
      )}

      {/* 搜刮彈出物資移轉視窗 (Loot Modal) */}
      {isLootModalOpen && (
        <div className="loot-modal-overlay">
          <div className="loot-modal-container">
            <div className="loot-modal-header">
              <h3>📦 搜刮物資 - {nearContainerRef.current?.name || '容器'}</h3>
              <button className="loot-modal-close-btn" onClick={handleCloseLootModal}>×</button>
            </div>
            
            <div className="loot-modal-body">
              {/* 左邊：容器物資 */}
              <div className="loot-modal-side container-side">
                <h4>容器物品 CONTAINER CONTENTS</h4>
                <div className="loot-modal-items">
                  {containerLootCoins > 0 && (
                    <div className="loot-modal-item-row coin-row" onClick={handleTakeCoins}>
                      <span className="loot-item-icon">🪙</span>
                      <div className="loot-item-info">
                        <div className="loot-item-name">Delta 金幣</div>
                        <div className="loot-item-desc">Delta Force 戰區通行貨幣</div>
                      </div>
                      <div className="loot-item-action">🪙 {containerLootCoins}</div>
                    </div>
                  )}
                  {containerLootItems.length === 0 && containerLootCoins === 0 ? (
                    <div className="loot-modal-empty">容器已被清空</div>
                  ) : (
                    containerLootItems.map(item => (
                      <div key={item.uid} className="loot-modal-item-row" onClick={() => handleTakeItem(item)}>
                        <span className="loot-item-icon">
                          {item.type === 'keycard' ? '💳' :
                           item.type === 'goldBar' ? '🪙' :
                           item.type === 'hardDrive' ? '💾' :
                           item.type === 'dogTag' ? '🪖' :
                           item.type === 'medkit' ? '➕' :
                           item.type === 'grenade' ? '💣' :
                           item.type === 'flashbang' ? '✨' :
                           item.type === 'smoke' ? '💨' : '🔫'}
                        </span>
                        <div className="loot-item-info">
                          <div className="loot-item-name">{ITEM_NAMES[item.type] || item.type}</div>
                          <div className="loot-item-desc">
                            {item.type === 'keycard' ? '用來開啟地圖中特定鎖定房的特殊卡片。' :
                             item.type === 'goldBar' ? '純度極高的金條，能在黑市高價售出。' :
                             item.type === 'hardDrive' ? '儲存有機密資料的加密硬碟，很有價值。' :
                             item.type === 'dogTag' ? '刻有陣亡軍人資訊的軍牌，可在黑市售出。' : '戰地實用物資。'}
                          </div>
                        </div>
                        <button className="loot-item-take-btn">拾取 TAKE</button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 右邊：個人戰術背包 */}
              <div className="loot-modal-side backpack-side">
                <h4>戰術背包 TACTICAL BACKPACK</h4>
                <div className="loot-modal-backpack-summary">
                  <div className="bp-stat-row">
                    <span>Delta 金幣:</span>
                    <span>🪙 {backpackCoins}</span>
                  </div>
                  <div className="bp-items-list">
                    {backpackItems.length === 0 ? (
                      <div className="loot-modal-empty">背包目前是空的</div>
                    ) : (
                      backpackItems.map((item, idx) => (
                        <div key={idx} className="bp-item-row">
                          <span>
                            {item.type === 'keycard' ? '💳' :
                             item.type === 'goldBar' ? '🪙' :
                             item.type === 'hardDrive' ? '💾' :
                             item.type === 'dogTag' ? '🪖' :
                             item.type === 'medkit' ? '➕' :
                             item.type === 'grenade' ? '💣' :
                             item.type === 'flashbang' ? '✨' :
                             item.type === 'smoke' ? '💨' : '🔫'} {ITEM_NAMES[item.type] || item.type}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="loot-modal-footer">
              <button className="loot-modal-btn take-all-btn" onClick={handleTakeAll}>全部拾取 TAKE ALL</button>
              <button className="loot-modal-btn close-btn" onClick={handleCloseLootModal}>關閉視窗 CLOSE</button>
            </div>
          </div>
        </div>
      )}

      {/* 波次倒數大字提示 HUD */}
      {/* 精銳伏擊警告橫幅 */}
      {gameState === 'active' && isAmbushAlertVisible && (
        <div className="ambush-warning-banner">
          <div className="ambush-warning-title">⚠️ 偵測到敵軍精銳伏擊</div>
          <div className="ambush-warning-subtitle">ELITE TEAM AMBUSH DETECTED! (雙倍擊殺金幣)</div>
        </div>
      )}

      {gameState === 'active' && waveCountdown > 0 && (
        <div className="wave-countdown-overlay">
          <div className="wave-countdown-title">NEXT WAVE IN</div>
          <div className="wave-countdown-number">{waveCountdown}</div>
          <div className="wave-countdown-subtitle">PREPARE FOR CONTACT</div>
        </div>
      )}

      {/* 戰術撤離直升機 HUD 覆蓋層 */}
      {gameState === 'active' && extractionActive && (
        <div className="evac-countdown-overlay">
          {extractionState === 'incoming' && (
            <>
              <div className="evac-countdown-title flashing-yellow">EVACUATION HELICOPTER INBOUND</div>
              <div className="evac-countdown-subtitle">LZ CLEARANCE IN PROGRESS | PREPARE FOR EVAC</div>
            </>
          )}
          {extractionState === 'landed' && (
            !isPlayerInExtractionZone ? (
              <>
                <div className="evac-countdown-title flashing-green">LZ ESTABLISHED</div>
                <div className="evac-countdown-subtitle">PROCEED TO THE EXTRACTION ZONE AT CENTER [0, 0]</div>
              </>
            ) : (
              <>
                <div className="evac-countdown-title">EXTRACTION IN PROGRESS</div>
                <div className="evac-countdown-bar-container">
                  <div className="evac-countdown-bar" style={{ width: `${((5.0 - extractionCountdown) / 5.0) * 100}%` }} />
                </div>
                <div className="evac-countdown-subtitle">HOLD POSITION FOR {extractionCountdown.toFixed(1)}s</div>
              </>
            )
          )}
        </div>
      )}

      {/* 戰術背包 HUD 面板 */}
      {gameState === 'active' && !isTutorial && (
        <div className="hud-backpack-panel">
          <h4>TACTICAL BACKPACK</h4>
          <div className={`backpack-item ${backpack.goldBar > 0 ? 'has-val' : ''}`}>
            <span>黃金金條 GOLD BAR</span>
            <span>x{backpack.goldBar}</span>
          </div>
          <div className={`backpack-item ${backpack.hardDrive > 0 ? 'has-val' : ''}`}>
            <span>加密硬碟 HARD DRIVE</span>
            <span>x{backpack.hardDrive}</span>
          </div>
          <div className={`backpack-item ${backpack.dogTag > 0 ? 'has-val' : ''}`}>
            <span>敵軍軍籍牌 DOG TAG</span>
            <span>x{backpack.dogTag}</span>
          </div>
          <div className={`backpack-item ${backpack.coins > 0 ? 'has-val' : ''}`}>
            <span>Delta 金幣 COINS</span>
            <span>🪙 {backpack.coins}</span>
          </div>
        </div>
      )}

      {/* 管理員戰術控制台 ADMIN CONSOLE */}
      {currentUser?.isAdmin && gameState === 'active' && (
        <div 
          className="admin-console-panel" 
          style={{
            position: 'absolute',
            top: '165px',
            left: '30px',
            background: 'rgba(8, 20, 12, 0.9)',
            border: '1px solid #00ff66',
            borderLeft: '4px solid #00ff66',
            borderRadius: '4px',
            padding: isAdminConsoleExpanded ? '12px 18px' : '4px 10px',
            zIndex: 9999,
            pointerEvents: 'auto',
            boxShadow: '0 0 15px rgba(0, 255, 102, 0.25)',
            fontFamily: 'monospace',
            width: isAdminConsoleExpanded ? '200px' : '100px',
            display: 'flex',
            flexDirection: 'column',
            gap: isAdminConsoleExpanded ? '8px' : '0px',
            transition: 'all 0.2s ease-in-out'
          }}
        >
          {isAdminConsoleExpanded ? (
            <>
              <div 
                style={{ 
                  color: '#00ff66', 
                  fontSize: '0.75rem', 
                  fontWeight: 'bold', 
                  borderBottom: '1px solid rgba(0, 255, 102, 0.3)', 
                  paddingBottom: '4px', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => setIsAdminConsoleExpanded(false)}
              >
                <span>🛠️ 特權控制台 ▲</span>
                <span style={{ fontSize: '0.6rem', background: 'rgba(0, 255, 102, 0.2)', padding: '1px 4px', borderRadius: '2px' }}>ADMIN</span>
              </div>
              
              <button 
                type="button"
                style={{
                  background: 'rgba(0, 255, 102, 0.1)',
                  border: '1px solid #00ff66',
                  color: '#00ff66',
                  padding: '5px',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  textAlign: 'left'
                }}
                onClick={() => {
                  setEnemies([]);
                  if (currentWave < 3) {
                    setWaveCountdown(5);
                    addKillFeedEntry('管理員跳過當前波次，下一波即將開始...', 'system');
                  } else {
                    setExtractionActive(true);
                    setExtractionState('incoming');
                    setExtractionCountdown(5.0);
                    addKillFeedEntry('管理員跳過全部防守波次！已呼叫撤離直升機！', 'system');
                    soundManager.startHelicopterSound();
                  }
                }}
              >
                ⏭️ 跳過波次 (O)
              </button>

              <button 
                type="button"
                style={{
                  background: 'rgba(0, 255, 102, 0.1)',
                  border: '1px solid #00ff66',
                  color: '#00ff66',
                  padding: '5px',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  textAlign: 'left'
                }}
                onClick={() => {
                  setEnemies([]);
                  setExtractionActive(true);
                  setExtractionState('landed');
                  setExtractionCountdown(0.0);
                  addKillFeedEntry('管理員呼叫直升機，LZ 已建立，請前往中心點撤離！', 'system');
                  soundManager.startHelicopterSound();
                }}
              >
                🚁 立即呼叫撤離
              </button>

              <button 
                type="button"
                style={{
                  background: 'rgba(0, 255, 102, 0.1)',
                  border: '1px solid #ffcc00',
                  color: '#ffcc00',
                  padding: '5px',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  textAlign: 'left'
                }}
                onClick={() => {
                  setGameState('victory');
                  if (controlsRef.current) {
                    controlsRef.current.unlock();
                  }
                  const duration = Math.round((Date.now() - runStatsRef.current.startTime) / 1000);
                  const accuracy = runStatsRef.current.shotsFired > 0 ? (runStatsRef.current.shotsHit / runStatsRef.current.shotsFired) : 0.8;
                  const total = (eliminated * 50) + 300 + (runStatsRef.current.headshots * 20) + 100;
                  setEndgameStats({
                    headshots: runStatsRef.current.headshots,
                    shotsFired: runStatsRef.current.shotsFired,
                    shotsHit: runStatsRef.current.shotsHit,
                    playTimeSeconds: duration,
                    coinsEarnedDetails: {
                      killsCoins: eliminated * 50,
                      victoryCoins: 300,
                      headshotsCoins: runStatsRef.current.headshots * 20,
                      accuracyCoins: 100,
                      total: total
                    }
                  });
                  
                  if (!currentUser.isGuest) {
                    try {
                      updateStats(currentUser.username, {
                        kills: eliminated,
                        victory: true,
                        headshots: runStatsRef.current.headshots,
                        shotsFired: runStatsRef.current.shotsFired,
                        shotsHit: runStatsRef.current.shotsHit,
                        playTimeSeconds: duration
                      });
                    } catch (e) {}
                  }
                  addKillFeedEntry('管理員瞬間通關！ (K)', 'system');
                }}
              >
                🏆 瞬間獲勝 (K)
              </button>

              <button 
                type="button"
                style={{
                  background: 'rgba(0, 255, 102, 0.1)',
                  border: '1px solid #00ff66',
                  color: '#00ff66',
                  padding: '5px',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  textAlign: 'left'
                }}
                onClick={() => {
                  setHealth(100);
                  addKillFeedEntry('管理員恢復生命值為 100% (P)', 'system');
                }}
              >
                ❤️ 恢復血量 (P)
              </button>
            </>
          ) : (
            <div 
              style={{ 
                color: '#00ff66', 
                fontSize: '0.72rem', 
                fontWeight: 'bold', 
                textAlign: 'center',
                cursor: 'pointer',
                userSelect: 'none',
                padding: '4px 0'
              }}
              onClick={() => setIsAdminConsoleExpanded(true)}
            >
              🛠️ 控制台 ▼
            </div>
          )}
        </div>
      )}

      {/* 物資箱範圍互動提示 */}
      {gameState === 'active' && isLocked && nearContainer && !isLooting && (
        <div 
          className="interaction-prompt container-prompt"
          style={{
            bottom: '35%',
            pointerEvents: device === 'mobile' ? 'auto' : 'none',
            cursor: device === 'mobile' ? 'pointer' : 'default'
          }}
        >
          {device === 'mobile' ? `HOLD [SEARCH] TO LOOT ${nearContainer.name}` : `HOLD [F] TO LOOT ${nearContainer.name}`}
        </div>
      )}

      {/* 閃光彈全螢幕致盲特效疊加層 */}
      {flashIntensity > 0 && (
        <div className="flashbang-blind-overlay" style={{ opacity: flashIntensity }} />
      )}

      {/* 3D Canvas 容器 */}
      <div className="canvas-container">
        <Canvas shadows camera={{ fov: 70, near: 0.1, far: 200 }}>
          {selectedMap === 'facility' && facilityEvent === 'fog' && (
            <fogExp2 attach="fog" args={['#10171d', 0.055]} />
          )}
          <ambientLight 
            intensity={selectedMap === 'facility' ? (facilityEvent === 'blackout' ? 0.02 : 0.65) : 0.5} 
            color={selectedMap === 'facility' ? (facilityEvent === 'alert' ? '#ff3333' : '#f5f6fa') : '#ffffff'} 
          />
          <directionalLight
            castShadow={selectedMap !== 'facility'}
            position={selectedMap === 'facility' ? [30, 15, 30] : [50, 80, 50]}
            intensity={selectedMap === 'facility' ? (facilityEvent === 'blackout' ? 0.0 : (facilityEvent === 'alert' ? 0.2 : 0.1)) : 1.5}
            color={selectedMap === 'facility' ? (facilityEvent === 'alert' ? '#ff8888' : '#6b829c') : '#ffffff'}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-near={0.5}
            shadow-camera-far={180}
            shadow-camera-left={-70}
            shadow-camera-right={70}
            shadow-camera-top={70}
            shadow-camera-bottom={-70}
          />
          <Sky 
            sunPosition={selectedMap === 'facility' ? [30, 15, 30] : [50, 80, 50]} 
            distance={450000} 
            turbidity={selectedMap === 'facility' ? 10 : 2}
            rayleigh={selectedMap === 'facility' ? 4 : 1}
          />

          {/* 地面與環境防禦工事 */}
          <Ground mapType={selectedMap} facilityEvent={facilityEvent} />
          <PerimeterWalls mapType={selectedMap} facilityZone={facilityZone} enemies={enemies} facilityEvent={facilityEvent} />
          <TacticalAssets mapType={selectedMap} hideCenter={extractionActive} facilityZone={facilityZone} enemies={enemies} facilityEvent={facilityEvent} />

          {/* 3D 戰術直升機撤離點 */}
          {selectedMap !== 'facility' && <LandingPad active={extractionActive} />}
          {selectedMap !== 'facility' && <ExtractionHelicopter active={extractionActive} onLanded={() => setExtractionState('landed')} />}

          {/* 3D 戰術補給站 */}
          {!extractionActive && (
            <AmmoSupplyStation position={[0, 0, -0.8]} active={ammoCooldown === 0} />
          )}
          <MedicalSupplyStation position={[3.0, 0, 92.0]} active={medCooldown === 0} />

          {/* 3D 戰術物資搜刮箱 */}
          {getAdjustedLootContainers().map((container) => (
            <LootCrate
              key={container.id}
              position={container.position}
              name={container.name}
              type={container.type}
              isLooted={!!lootedContainers[container.id]}
            />
          ))}

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
              type={g.type}
              onExplode={(point) => handleExplodeGrenade(g.id, point, g.type)}
            />
          ))}

          {/* 渲染戰術煙霧彈生成的煙霧雲 */}
          {smokeClouds.map((smoke) => (
            <SmokeCloud
              key={smoke.id}
              position={smoke.position}
              radius={smoke.radius}
              timeLeft={smoke.timeLeft}
            />
          ))}

          {/* 渲染敵軍投擲的手榴彈 */}
          {enemyGrenadeEntities.map((g) => (
            <EnemyGrenade
              key={g.id}
              position={g.position}
              velocity={g.velocity}
              targetPos={g.targetPos}
              onExplode={(point) => handleEnemyGrenadeExplode(g.id, point)}
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
                onThrowGrenade={addEnemyGrenade}
                smokeClouds={smokeClouds}
                mapType={selectedMap}
                facilityEvent={facilityEvent}
                enemies={enemies}
                onShootEnemy={handleShootEnemy}
              />
            )
          ))}

          {/* 漂浮傷害數字 */}
          {damagePopups.map((popup) => (
            <Html key={popup.id} position={[popup.position.x, popup.position.y + 0.8, popup.position.z]} center>
              <div className={`damage-popup ${popup.isHeadshot ? 'headshot' : ''}`}>
                {popup.amount}
              </div>
            </Html>
          ))}

          {/* 突擊步槍與手槍模型 */}
          <Weapon gunRef={gunRef} muzzleFlashRef={muzzleFlashRef} isAds={isAds} isLocked={isLocked} activeWeapon={activeWeapon} activeWeaponId={activeWeaponId} isHealing={isHealing} isMeleeing={isMeleeing} meleeProgress={meleeProgress} attachments={activeWeapon === 'primary' ? currentUser?.equipped?.primaryAttachments : currentUser?.equipped?.secondaryAttachments} selectedMap={selectedMap} facilityEvent={facilityEvent} flashlightRef={flashlightRef} targetRef={targetRef} />

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
            flashbangs={flashbangs}
            setFlashbangs={setFlashbangs}
            smokes={smokes}
            setSmokes={setSmokes}
            activeThrowable={activeThrowable}
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
            cameraRef={cameraRef}
            primaryWeaponId={primaryWeaponId}
            secondaryWeaponId={secondaryWeaponId}
            nearContainer={nearContainer}
            setNearContainer={setNearContainer}
            isLooting={isLooting}
            setIsLooting={setIsLooting}
            lootProgress={lootProgress}
            setLootProgress={setLootProgress}
            lootedContainers={lootedContainers}
            startLooting={startLooting}
            stopLooting={stopLooting}
            extractionActive={extractionActive}
            extractionState={extractionState}
            setExtractionCountdown={setExtractionCountdown}
            setIsPlayerInExtractionZone={setIsPlayerInExtractionZone}
            onExtractSuccess={handleExtractSuccess}
            primaryConfig={primaryConfig}
            secondaryConfig={secondaryConfig}
            selectedMap={selectedMap}
            lootContainers={getAdjustedLootContainers()}
            facilityZone={facilityZone}
            onAdvanceFacilityZone={handleAdvanceFacilityZone}
            adminTeleportTrigger={adminTeleportTrigger}
            facilityEvent={facilityEvent}
            flashlightRef={flashlightRef}
            targetRef={targetRef}
          />

          {/* Drei 第一人稱滑鼠鎖定控制器 */}
          {device !== 'mobile' && gameState === 'active' && !isLootModalOpen && (
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
