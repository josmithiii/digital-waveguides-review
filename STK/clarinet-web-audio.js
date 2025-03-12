// STK Clarinet implementation for Web Audio API
// Based on the STK (Synthesis ToolKit) C++ implementation

class ReedTable {
  constructor(audioContext) {
    // Create a WaveShaperNode for the non-linear reed table
    this.waveShaper = audioContext.createWaveShaper();
    
    // Default parameters
    this.offset = 0.7;
    this.slope = -0.3;
    
    // Initialize the waveshaper curve
    this.updateCurve();
  }
  
  // Update the waveshaper curve based on offset and slope
  updateCurve() {
    const tableSize = 4096;
    const curve = new Float32Array(tableSize);
    
    for (let i = 0; i < tableSize; i++) {
      // Map index to range -1 to 1
      let x = (i / (tableSize - 1)) * 2 - 1;
      
      // Apply reed table function
      // Based on STK ReedTable implementation
      let y = this.offset + (this.slope * x);
      
      // Apply limiting
      if (y > 1.0) y = 1.0;
      if (y < -1.0) y = -1.0;
      
      curve[i] = y;
    }
    
    this.waveShaper.curve = curve;
  }
  
  // Set reed table offset (reed rest position)
  setOffset(offset) {
    this.offset = offset;
    this.updateCurve();
  }
  
  // Set reed table slope (reed stiffness)
  setSlope(slope) {
    this.slope = slope;
    this.updateCurve();
  }
}

class Clarinet {
  constructor(audioContext) {
    this.context = audioContext;
    
    // Create nodes
    this.outputNode = this.context.createGain();
    this.boreLengthGain = this.context.createGain();
    
    // Delay line (bore) - Web Audio DelayNode
    this.delayLine = this.context.createDelay(1.0); // 1 second max delay
    
    // Non-linear reed function
    this.reedTable = new ReedTable(this.context);
    
    // One-zero filter for bore losses
    // Approximate with BiquadFilter
    this.lossFilter = this.context.createBiquadFilter();
    this.lossFilter.type = "lowpass";
    this.lossFilter.frequency.value = 12000;
    
    // Noise source (breath noise)
    this.noiseSource = this.context.createBufferSource();
    this.noiseGain = this.context.createGain();
    this.noiseGain.gain.value = 0.2;
    this.createNoiseBuffer();
    
    // Breath pressure envelope
    this.breathEnvelope = this.context.createGain();
    this.breathEnvelope.gain.value = 0.0;
    
    // Vibrato
    this.vibratoOsc = this.context.createOscillator();
    this.vibratoGain = this.context.createGain();
    this.vibratoGain.gain.value = 0.0;
    this.vibratoOsc.frequency.value = 5.0;
    this.vibratoOsc.type = "sine";
    
    // Set default parameters
    this.frequency = 440.0;
    this.sampleRate = this.context.sampleRate;
    
    // Connect the components to create the waveguide feedback loop
    // This will be done in the connect() method
    
    // Start oscillators
    this.vibratoOsc.start();
    this.noiseSource.loop = true;
    this.noiseSource.start();
    
    // Connect the graph
    this.connect();
  }
  
  // Create and connect the audio graph
  connect() {
    // Feedback loop:
    // Breath pressure + noise -> reed table -> bore -> loss filter -> output
    //                     ^                                    |
    //                     |                                    |
    //                     +------------------------------------+
    
    // Breath and noise to reed input
    this.breathEnvelope.connect(this.reedTable.waveShaper);
    this.noiseGain.connect(this.reedTable.waveShaper);
    
    // Vibrato modulation
    this.vibratoOsc.connect(this.vibratoGain);
    this.vibratoGain.connect(this.breathEnvelope.gain);
    
    // Reed table to delay line (bore)
    this.reedTable.waveShaper.connect(this.delayLine);
    
    // Delay line to loss filter
    this.delayLine.connect(this.lossFilter);
    
    // Loss filter to output
    this.lossFilter.connect(this.outputNode);
    
    // Feedback: loss filter back to reed table
    this.lossFilter.connect(this.reedTable.waveShaper);
    
    // Set bore length based on current frequency
    this.setFrequency(this.frequency);
  }
  
  // Create noise buffer for breath noise
  createNoiseBuffer() {
    const bufferSize = this.sampleRate;
    const noiseBuffer = this.context.createBuffer(1, bufferSize, this.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    
    this.noiseSource.buffer = noiseBuffer;
  }
  
  // Connect to destination
  connectTo(destination) {
    this.outputNode.connect(destination);
  }
  
  // Set frequency (pitch)
  setFrequency(frequency) {
    this.frequency = frequency;
    
    // Calculate delay length based on frequency
    // Delay length = (sampleRate / frequency) / 2 - halfFilterDelay
    // In the original STK, this accounts for fractional delay
    // We approximate with the Web Audio DelayNode
    const delayLength = (this.sampleRate / frequency) / 2 - 0.5;
    
    // Ensure delay length is positive and within limits
    const safeDelayLength = Math.max(0.1, Math.min(delayLength, 1.0));
    
    // Set delay length
    this.delayLine.delayTime.setTargetAtTime(safeDelayLength / this.sampleRate, this.context.currentTime, 0.01);
  }
  
  // Start playing a note
  noteOn(frequency, velocity) {
    // Set frequency
    this.setFrequency(frequency);
    
    // Scale velocity to appropriate breath pressure
    const breathPressure = velocity * 0.01;
    
    // Ramp up breath pressure
    this.breathEnvelope.gain.cancelScheduledValues(this.context.currentTime);
    this.breathEnvelope.gain.setValueAtTime(this.breathEnvelope.gain.value, this.context.currentTime);
    this.breathEnvelope.gain.linearRampToValueAtTime(breathPressure, this.context.currentTime + 0.1);
  }
  
  // Stop playing a note
  noteOff(velocity) {
    // Ramp down breath pressure
    const releaseTime = 0.1;
    this.breathEnvelope.gain.cancelScheduledValues(this.context.currentTime);
    this.breathEnvelope.gain.setValueAtTime(this.breathEnvelope.gain.value, this.context.currentTime);
    this.breathEnvelope.gain.linearRampToValueAtTime(0.0, this.context.currentTime + releaseTime);
  }
  
  // Control change - similar to MIDI CC
  controlChange(number, value) {
    const normalizedValue = value / 128.0;
    
    switch (number) {
      case 1: // Vibrato gain (modulation wheel)
        this.vibratoGain.gain.setValueAtTime(normalizedValue * 0.2, this.context.currentTime);
        break;
        
      case 2: // Reed stiffness
        this.reedTable.setSlope(-0.1 - (normalizedValue * 0.4));
        break;
        
      case 4: // Breath noise gain
        this.noiseGain.gain.setValueAtTime(normalizedValue * 0.4, this.context.currentTime);
        break;
        
      case 11: // Vibrato frequency
        this.vibratoOsc.frequency.setValueAtTime(normalizedValue * 12 + 0.5, this.context.currentTime);
        break;
        
      case 128: // Breath pressure
        this.breathEnvelope.gain.cancelScheduledValues(this.context.currentTime);
        this.breathEnvelope.gain.setValueAtTime(this.breathEnvelope.gain.value, this.context.currentTime);
        this.breathEnvelope.gain.linearRampToValueAtTime(normalizedValue, this.context.currentTime + 0.05);
        break;
    }
  }
}

// Simple reverb implementation (similar to JCRev)
class SimpleReverb {
  constructor(audioContext) {
    this.context = audioContext;
    
    // Create nodes
    this.input = this.context.createGain();
    this.output = this.context.createGain();
    this.wetGain = this.context.createGain();
    this.dryGain = this.context.createGain();
    
    // Connect dry path
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);
    
    // Create parallel comb filters
    this.combDelays = [];
    const combTimes = [25.31, 26.94, 28.96, 30.75]; // in milliseconds
    
    for (let i = 0; i < combTimes.length; i++) {
      const delay = this.context.createDelay(1.0);
      const feedback = this.context.createGain();
      
      delay.delayTime.value = combTimes[i] / 1000;
      feedback.gain.value = 0.8;
      
      this.input.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(this.wetGain);
      
      this.combDelays.push(delay);
    }
    
    // Create allpass filters in series
    this.allpassDelays = [];
    const allpassTimes = [5.0, 1.68]; // in milliseconds
    
    let lastNode = this.wetGain;
    
    for (let i = 0; i < allpassTimes.length; i++) {
      const delay = this.context.createDelay(0.1);
      const gain = this.context.createGain();
      const gainInv = this.context.createGain();
      const mixer = this.context.createGain();
      
      delay.delayTime.value = allpassTimes[i] / 1000;
      gain.gain.value = 0.7;
      gainInv.gain.value = -0.7;
      
      lastNode.connect(delay);
      lastNode.connect(gainInv);
      delay.connect(gain);
      gain.connect(mixer);
      gainInv.connect(mixer);
      
      lastNode = mixer;
    }
    
    // Connect the last allpass to the output
    lastNode.connect(this.wetGain);
    this.wetGain.connect(this.output);
    
    // Set default mix
    this.setEffectMix(0.2);
  }
  
  // Connect input
  connectInput(source) {
    source.connect(this.input);
  }
  
  // Connect output
  connectOutput(destination) {
    this.output.connect(destination);
  }
  
  // Set wet/dry mix
  setEffectMix(mix) {
    // Ensure mix is between 0 and 1
    mix = Math.max(0, Math.min(mix, 1));
    
    this.wetGain.gain.value = mix;
    this.dryGain.gain.value = 1 - mix;
  }
}

// Demo page setup
window.addEventListener('load', () => {
  // Create UI elements
  const startButton = document.createElement('button');
  startButton.textContent = 'Start Clarinet';
  startButton.style.padding = '10px';
  startButton.style.margin = '10px';
  document.body.appendChild(startButton);
  
  const keyboardDiv = document.createElement('div');
  keyboardDiv.style.display = 'flex';
  keyboardDiv.style.margin = '20px';
  document.body.appendChild(keyboardDiv);
  
  // Create control sliders
  const controlsDiv = document.createElement('div');
  controlsDiv.style.margin = '20px';
  document.body.appendChild(controlsDiv);
  
  const createSlider = (name, min, max, value, ccNumber) => {
    const div = document.createElement('div');
    div.style.margin = '10px 0';
    
    const label = document.createElement('label');
    label.textContent = name;
    label.style.display = 'inline-block';
    label.style.width = '150px';
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.value = value;
    slider.style.width = '200px';
    
    const valueDisplay = document.createElement('span');
    valueDisplay.textContent = value;
    valueDisplay.style.marginLeft = '10px';
    
    div.appendChild(label);
    div.appendChild(slider);
    div.appendChild(valueDisplay);
    controlsDiv.appendChild(div);
    
    return {slider, valueDisplay};
  };
  
  // Create piano keyboard
  const notes = [
    {name: 'C4', freq: 261.63, key: 'a'},
    {name: 'D4', freq: 293.66, key: 's'},
    {name: 'E4', freq: 329.63, key: 'd'},
    {name: 'F4', freq: 349.23, key: 'f'},
    {name: 'G4', freq: 392.00, key: 'g'},
    {name: 'A4', freq: 440.00, key: 'h'},
    {name: 'B4', freq: 493.88, key: 'j'},
    {name: 'C5', freq: 523.25, key: 'k'}
  ];
  
  // Initialize audio on button click (to handle autoplay restrictions)
  let clarinet, reverb, audioContext;
  
  startButton.addEventListener('click', async () => {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create clarinet and reverb
    clarinet = new Clarinet(audioContext);
    reverb = new SimpleReverb(audioContext);
    
    // Connect clarinet to reverb and reverb to output
    clarinet.connectTo(reverb.input);
    reverb.connectOutput(audioContext.destination);
    
    // Create keyboard
    notes.forEach(note => {
      const key = document.createElement('div');
      key.textContent = `${note.name}\n(${note.key})`;
      key.style.width = '60px';
      key.style.height = '120px';
      key.style.backgroundColor = note.name.includes('#') ? 'black' : 'white';
      key.style.color = note.name.includes('#') ? 'white' : 'black';
      key.style.border = '1px solid black';
      key.style.textAlign = 'center';
      key.style.lineHeight = '180px';
      key.style.userSelect = 'none';
      key.style.cursor = 'pointer';
      
      // Mouse events
      key.addEventListener('mousedown', () => {
        clarinet.noteOn(note.freq, 100);
        key.style.backgroundColor = note.name.includes('#') ? '#333' : '#ddd';
      });
      
      key.addEventListener('mouseup', () => {
        clarinet.noteOff(64);
        key.style.backgroundColor = note.name.includes('#') ? 'black' : 'white';
      });
      
      key.addEventListener('mouseleave', () => {
        clarinet.noteOff(64);
        key.style.backgroundColor = note.name.includes('#') ? 'black' : 'white';
      });
      
      keyboardDiv.appendChild(key);
    });
    
    // Create control sliders
    const controls = [
      {name: 'Reed Stiffness', min: 0, max: 127, value: 64, cc: 2},
      {name: 'Breath Noise', min: 0, max: 127, value: 25, cc: 4},
      {name: 'Vibrato Rate', min: 0, max: 127, value: 50, cc: 11},
      {name: 'Vibrato Depth', min: 0, max: 127, value: 0, cc: 1},
      {name: 'Reverb Mix', min: 0, max: 100, value: 20}
    ];
    
    controls.forEach(control => {
      const {slider, valueDisplay} = createSlider(control.name, control.min, control.max, control.value);
      
      slider.addEventListener('input', () => {
        valueDisplay.textContent = slider.value;
        
        if (control.name === 'Reverb Mix') {
          reverb.setEffectMix(slider.value / 100);
        } else {
          clarinet.controlChange(control.cc, parseInt(slider.value));
        }
      });
    });
    
    // Keyboard events
    document.addEventListener('keydown', (event) => {
      const note = notes.find(n => n.key === event.key);
      if (note && !event.repeat) {
        clarinet.noteOn(note.freq, 100);
        // Highlight the key
        const keyIndex = notes.indexOf(note);
        keyboardDiv.children[keyIndex].style.backgroundColor = note.name.includes('#') ? '#333' : '#ddd';
      }
    });
    
    document.addEventListener('keyup', (event) => {
      const note = notes.find(n => n.key === event.key);
      if (note) {
        clarinet.noteOff(64);
        // Reset the key color
        const keyIndex = notes.indexOf(note);
        keyboardDiv.children[keyIndex].style.backgroundColor = note.name.includes('#') ? 'black' : 'white';
      }
    });
    
    startButton.disabled = true;
    startButton.textContent = 'Clarinet is running';
  });
});