/**
 * Hardware Button Panic Trigger Service
 * Detects rapid volume/power button presses to trigger panic alerts
 * Works on both mobile devices and desktop browsers
 */

class HardwareButtonDetector {
  constructor(config = {}) {
    this.config = {
      triggerMethod: config.triggerMethod || 'volume_up_3x',
      sensitivity: config.sensitivity || 'medium',
      confirmationRequired: config.confirmationRequired || false,
      vibrationFeedback: config.vibrationFeedback !== false,
      timeWindow: this.getTimeWindow(config.sensitivity),
      requiredPresses: this.getRequiredPresses(config.triggerMethod),
      ...config
    };

    this.pressHistory = [];
    this.isActive = false;
    this.onTrigger = config.onTrigger || (() => {});
    this.onPatternProgress = config.onPatternProgress || (() => {});
    
    // Bind methods
    this.handleVolumeUp = this.handleVolumeUp.bind(this);
    this.handleVolumeDown = this.handleVolumeDown.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  getTimeWindow(sensitivity) {
    // Time window for button pattern detection (in ms)
    const windows = {
      low: 5000,    // 5 seconds - more forgiving
      medium: 3000, // 3 seconds
      high: 2000    // 2 seconds - requires rapid presses
    };
    return windows[sensitivity] || windows.medium;
  }

  getRequiredPresses(triggerMethod) {
    // Extract number from pattern like "volume_up_3x" or "power_5x"
    const match = triggerMethod.match(/(\d+)x/);
    if (match) {
      return parseInt(match[1], 10);
    }
    // Default patterns
    if (triggerMethod.includes('3x')) return 3;
    if (triggerMethod.includes('5x')) return 5;
    return 3;
  }

  start() {
    if (this.isActive) return;
    
    console.log('[HardwareButtonDetector] Starting detector with config:', this.config);
    this.isActive = true;

    // Listen for keyboard events (volume keys, power button simulation)
    document.addEventListener('keydown', this.handleKeyDown);
    
    // Listen for visibility changes (power button on mobile often triggers this)
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    // Try to detect volume buttons on mobile
    this.detectVolumeButtons();

    console.log('[HardwareButtonDetector] Detector active');
  }

  stop() {
    if (!this.isActive) return;
    
    console.log('[HardwareButtonDetector] Stopping detector');
    this.isActive = false;

    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    // Clear any active listeners
    if (this.volumeUpListener) {
      this.volumeUpListener();
      this.volumeUpListener = null;
    }

    this.pressHistory = [];
  }

  handleKeyDown(event) {
    if (!this.isActive) return;

    // Map keyboard keys to button types
    let buttonType = null;

    // Volume keys (may vary by browser/device)
    if (event.key === 'AudioVolumeUp' || event.keyCode === 175) {
      buttonType = 'volume_up';
    } else if (event.key === 'AudioVolumeDown' || event.keyCode === 174) {
      buttonType = 'volume_down';
    } 
    // Power button simulation (ESC or F1-F12 keys can be configured)
    else if (event.key === 'Escape' && event.shiftKey && event.ctrlKey) {
      // Shift+Ctrl+Esc as emergency trigger (desktop testing)
      buttonType = 'power_button';
    }
    // Alternative: Use specific key combinations as panic triggers
    else if (event.key === 'F9' && event.ctrlKey) {
      // Ctrl+F9 as panic trigger (easy to press in emergency)
      buttonType = 'volume_up';
    }

    if (buttonType) {
      event.preventDefault();
      this.recordPress(buttonType);
    }
  }

  handleVisibilityChange() {
    // Power button often triggers visibility change on mobile
    if (document.hidden && this.config.triggerMethod.includes('power')) {
      this.recordPress('power_button');
    }
  }

  detectVolumeButtons() {
    // Modern browsers don't directly expose volume button events
    // But we can use keyboard events and media session API

    // Try to capture volume through media session (limited support)
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('seekbackward', () => {
          this.recordPress('volume_down');
        });
        navigator.mediaSession.setActionHandler('seekforward', () => {
          this.recordPress('volume_up');
        });
      } catch (error) {
        console.log('[HardwareButtonDetector] Media session not supported:', error.message);
      }
    }

    // Alternative: Use deviceorientation changes as trigger indicator
    // Rapid phone movements can indicate panic situation
    if (this.config.useMotionDetection) {
      let shakeCount = 0;
      let lastShake = 0;

      window.addEventListener('devicemotion', (event) => {
        const acceleration = event.accelerationIncludingGravity;
        const now = Date.now();

        if (acceleration) {
          const force = Math.sqrt(
            Math.pow(acceleration.x, 2) +
            Math.pow(acceleration.y, 2) +
            Math.pow(acceleration.z, 2)
          );

          // Detect significant shake (threshold depends on device)
          if (force > 25 && now - lastShake > 300) {
            shakeCount++;
            lastShake = now;

            if (shakeCount >= 3) {
              this.recordPress('motion_shake');
              shakeCount = 0;
            }
          }

          // Reset shake count after 2 seconds
          if (now - lastShake > 2000) {
            shakeCount = 0;
          }
        }
      });
    }
  }

  recordPress(buttonType) {
    const now = Date.now();
    
    // Clean old presses outside time window
    this.pressHistory = this.pressHistory.filter(
      press => now - press.timestamp < this.config.timeWindow
    );

    // Add new press
    this.pressHistory.push({
      type: buttonType,
      timestamp: now
    });

    console.log(`[HardwareButtonDetector] Recorded ${buttonType}, count: ${this.pressHistory.length}/${this.config.requiredPresses}`);

    // Provide visual/haptic feedback
    this.provideFeedback(this.pressHistory.length);

    // Notify progress
    if (this.onPatternProgress) {
      this.onPatternProgress({
        count: this.pressHistory.length,
        required: this.config.requiredPresses,
        progress: (this.pressHistory.length / this.config.requiredPresses) * 100
      });
    }

    // Check if pattern is complete
    this.checkPattern();
  }

  checkPattern() {
    const triggerType = this.config.triggerMethod.split('_').slice(0, 2).join('_');
    
    // Filter presses by type
    const relevantPresses = this.pressHistory.filter(press => {
      if (triggerType === 'volume_up') return press.type === 'volume_up';
      if (triggerType === 'volume_down') return press.type === 'volume_down';
      if (triggerType === 'power_button') return press.type === 'power_button';
      if (triggerType === 'motion_shake') return press.type === 'motion_shake';
      return false;
    });

    // Check if we have enough presses
    if (relevantPresses.length >= this.config.requiredPresses) {
      console.log('[HardwareButtonDetector] Pattern detected! Triggering panic...');
      this.triggerPanic(relevantPresses);
      
      // Clear history after trigger
      this.pressHistory = [];
    }
  }

  async triggerPanic(presses) {
    // Strong vibration feedback
    this.vibrate([200, 100, 200, 100, 200]);

    const triggerData = {
      triggerType: presses[0].type,
      triggerPattern: this.config.triggerMethod,
      triggerCount: presses.length,
      deviceInfo: this.getDeviceInfo(),
      timestamp: Date.now()
    };

    // If confirmation required, show dialog
    if (this.config.confirmationRequired) {
      const confirmed = await this.showConfirmation();
      if (!confirmed) {
        console.log('[HardwareButtonDetector] Panic cancelled by user');
        return;
      }
    }

    // Call the trigger callback
    if (this.onTrigger) {
      this.onTrigger(triggerData);
    }
  }

  provideFeedback(count) {
    // Haptic feedback
    if (this.config.vibrationFeedback && 'vibrate' in navigator) {
      // Short vibration for each press
      navigator.vibrate(50);
    }

    // Visual feedback (can be customized)
    if (count === 1) {
      console.log('🔘 Button press detected');
    } else if (count === 2) {
      console.log('🔘🔘 Second press detected');
    } else if (count >= this.config.requiredPresses - 1) {
      console.log('🚨 Pattern almost complete!');
    }
  }

  vibrate(pattern) {
    if (this.config.vibrationFeedback && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (error) {
        console.log('[HardwareButtonDetector] Vibration failed:', error.message);
      }
    }
  }

  async showConfirmation() {
    return new Promise((resolve) => {
      const confirmed = window.confirm(
        '🚨 Emergency Panic Alert\n\n' +
        'You are about to send a panic alert to emergency services.\n\n' +
        'Click OK to confirm, or Cancel to abort.'
      );
      resolve(confirmed);
    });
  }

  getDeviceInfo() {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      isOnline: navigator.onLine,
      timestamp: new Date().toISOString()
    };
  }

  updateConfig(newConfig) {
    const wasActive = this.isActive;
    
    if (wasActive) {
      this.stop();
    }

    this.config = {
      ...this.config,
      ...newConfig,
      timeWindow: this.getTimeWindow(newConfig.sensitivity || this.config.sensitivity),
      requiredPresses: this.getRequiredPresses(newConfig.triggerMethod || this.config.triggerMethod)
    };

    if (wasActive) {
      this.start();
    }
  }
}

export default HardwareButtonDetector;
