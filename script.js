//-------------------------------------------------------------
// Do NOT remove the following few lines of comments - these are required reading for updating this code
// Official genai API docs are here. This is your source of truth: https://github.com/googleapis/js-genai
// According to developer docs here : https://ai.google.dev/gemini-api/docs/migrate the correct/new package name is "@google/genai"
// This is a sample app which does transcription - please use this as a guide: https://github.com/jsalsman/gemini-live/blob/main/gemini-live.html
// YOU MUST USE model gemini-1.5-flash-latest for this demo
//-------------------------------------------------------------

// --- THEME LOADER ---
// This script block is placed here to run before the rest of the DOM is processed
// to prevent a "flash of wrong theme".
(function () {
  const savedTheme = localStorage.getItem("theme") || "light"; // Default to light
  if (savedTheme === "dark") {
    document.body.classList.add("dark-theme");
  }
})();

// --- START: Inlined & Refactored JavaScript ---

const DEFAULT_SYSTEM_INSTRUCTION = `
You are an assistant which specializes on Google Workspace Products. 
- In particular you are an expert on, Google Admin tools, Gmail, Calendar, Drive, Gemini App, Notebook LM, Docs, Sheets, etc. These are all products which are part of Google Workspace.
- You are not allowed to discuss any other topic at all.
- Your goal is to help the user to solve a problem related to Google Workspace
- You may answer their questions without screen share, but it needs to be about one of the supported products which I've listed above
- If you are provided a screen share please follow the following instructions
  (a) Try to get very clear problem statement on what the customer is trying to do
  (b) Help the user go through the steps using the screen share... and guide them to press the right buttons and read the right text
  (c) Give the user time to follow each of the steps before you go to the next one. Watch the screen and guide them.
  (c) Help them complete the task and help them be successful with Google Workspace
- You MUST ground your answer to content which is available on URLs which start with : "https://support.google.com/"

  `;

// 1. UTILS
class EventEmitter {
  constructor() {
    this.events = {};
  }
  on(eventName, listener) {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }
    this.events[eventName].push(listener);
  }
  emit(eventName, ...args) {
    if (!this.events[eventName]) {
      return;
    }
    this.events[eventName].forEach((listener) => listener(...args));
  }
}
function blobToJSON(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) {
        resolve(JSON.parse(reader.result));
      } else {
        reject("Failed to parse blob to JSON");
      }
    };
    reader.readAsText(blob);
  });
}
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
function arrayBufferToBase64(buffer) {
  try {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch (error) {
    console.error("Failed to convert array buffer to base64: " + error.message);
  }
}

// 2. AUDIO PROCESSOR
const audioProcessorCode = `class AudioProcessingWorklet extends AudioWorkletProcessor { constructor() { super(); this.buffer = new Int16Array(2048); this.bufferWriteIndex = 0; } process(inputs) { if (inputs[0].length) { this.processChunk(inputs[0][0]); } return true; } sendAndClearBuffer() { this.port.postMessage({ event: 'chunk', data: { int16arrayBuffer: this.buffer.slice(0, this.bufferWriteIndex).buffer } }); this.bufferWriteIndex = 0; } processChunk(float32Array) { for (let i = 0; i < float32Array.length; i++) { const int16Value = Math.max(-32768, Math.min(32767, Math.floor(float32Array[i] * 32768))); this.buffer[this.bufferWriteIndex++] = int16Value; if (this.bufferWriteIndex >= this.buffer.length) { this.sendAndClearBuffer(); } } } } registerProcessor('audio-recorder-worklet', AudioProcessingWorklet);`;
const blob = new Blob([audioProcessorCode], { type: "application/javascript" });
const audioProcessorUrl = URL.createObjectURL(blob);

// 3. CONFIG
const getWebsocketUrl = () =>
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${localStorage.getItem(
    "apiKey"
  )}`;
const MODEL_SAMPLE_RATE = parseInt(localStorage.getItem("sampleRate")) || 24000;
const getConfig = () => {
  let systemInstructions =
    localStorage.getItem("systemInstructions") || DEFAULT_SYSTEM_INSTRUCTION;
  const languageCode = localStorage.getItem("language") || "en-US";

  const languageMap = {
    "es-ES": "Spanish",
    "fr-FR": "French",
    "de-DE": "German",
    "ja-JP": "Japanese",
    "hi-IN": "Hindi",
  };

  if (languageCode !== "en-US" && languageMap[languageCode]) {
    const languageName = languageMap[languageCode];
    systemInstructions += `\n\nPlease make sure you are talking to the user using ${languageName} language which is what the customer requested.`;
  }

  return {
    model: "models/gemini-2.0-flash-exp",
    tools: [{ googleSearchRetrieval: {} }],
    generationConfig: {
      temperature: parseFloat(localStorage.getItem("temperature")) || 0.9,
      top_p: parseFloat(localStorage.getItem("top_p")) || 1.0,
      top_k: parseInt(localStorage.getItem("top_k")) || 32,
      responseModalities: "audio",
      speechConfig: {
        languageCode: languageCode,
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: localStorage.getItem("voiceName") || "Puck",
          },
        },
      },
    },
    systemInstruction: {
      parts: [
        {
          text: systemInstructions,
        },
      ],
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    ],
  };
};

// 4. WEBSOCKET CLIENT
class GeminiWebsocketClient extends EventEmitter {
  constructor(name, url, config) {
    super();
    this.name = name || "WebSocketClient";
    this.url = url;
    this.ws = null;
    this.config = config;
  }
  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    console.info("🔗 Establishing WebSocket connection...");
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.onopen = () => {
        console.info("🔗 Successfully connected");
        this.ws = ws;
        this.sendJSON({ setup: this.config });
        resolve();
      };
      ws.onerror = (err) => {
        reject(err);
      };
      ws.onmessage = (e) => this.receive(e.data);
    });
  }
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      console.info("Disconnected");
    }
  }
  async receive(blob) {
    const response = await blobToJSON(blob);
    if (response.serverContent?.modelTurn?.parts) {
      const parts = response.serverContent.modelTurn.parts;
      const audioPart = parts.find((p) =>
        p.inlineData?.mimeType.startsWith("audio/pcm")
      );
      if (audioPart) {
        this.emit("audio", base64ToArrayBuffer(audioPart.inlineData.data));
      }
    }
    if (response.serverContent?.interrupted) this.emit("interrupted");
    if (response.serverContent?.turnComplete) this.emit("turn_complete");
  }
  async sendAudio(base64audio) {
    this.sendJSON({
      realtimeInput: {
        mediaChunks: [{ mimeType: "audio/pcm", data: base64audio }],
      },
    });
  }
  async sendImage(base64image) {
    this.sendJSON({
      realtimeInput: {
        mediaChunks: [{ mimeType: "image/jpeg", data: base64image }],
      },
    });
  }
  async sendJSON(json) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(json));
    }
  }
}

// 5. AUDIO RECORDER, STREAMER, VISUALIZER
class AudioRecorder {
  constructor() {
    this.sampleRate = 16000;
    this.stream = null;
    this.audioContext = null;
    this.isRecording = false;
  }
  async start(onAudioData) {
    this.onAudioData = onAudioData;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: this.sampleRate,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    await this.audioContext.audioWorklet.addModule(audioProcessorUrl);
    this.processor = new AudioWorkletNode(
      this.audioContext,
      "audio-recorder-worklet"
    );
    this.processor.port.onmessage = (e) => {
      if (this.isRecording && e.data.event === "chunk") {
        this.onAudioData(arrayBufferToBase64(e.data.data.int16arrayBuffer));
      }
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    this.isRecording = true;
  }
  stop() {
    if (!this.isRecording) return;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioContext?.close();
    this.isRecording = false;
  }
  async toggleMic() {
    if (this.stream) {
      const enabled = !this.stream.getAudioTracks()[0].enabled;
      this.stream.getAudioTracks()[0].enabled = enabled;
      return enabled;
    }
    return false;
  }
}
class AudioStreamer {
  constructor(context) {
    this.context = context;
    this.audioQueue = [];
    this.isPlaying = false;
    this.sampleRate = MODEL_SAMPLE_RATE;
    this.scheduledTime = 0;
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);
    this.isInitialized = false;
  }
  async initialize() {
    if (this.context.state === "suspended") await this.context.resume();
    this.isInitialized = true;
  }
  streamAudio(chunk) {
    if (!this.isInitialized || !(chunk instanceof Uint8Array)) return;
    const float32Array = new Float32Array(chunk.buffer.byteLength / 2);
    const dataView = new DataView(chunk.buffer);
    for (let i = 0; i < float32Array.length; i++) {
      float32Array[i] = dataView.getInt16(i * 2, true) / 32768.0;
    }
    this.audioQueue.push(float32Array);
    if (!this.isPlaying) this.scheduleNextBuffer();
  }
  scheduleNextBuffer() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }
    this.isPlaying = true;
    const audioData = this.audioQueue.shift();
    const buffer = this.context.createBuffer(
      1,
      audioData.length,
      this.sampleRate
    );
    buffer.getChannelData(0).set(audioData);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);
    const startTime = Math.max(this.scheduledTime, this.context.currentTime);
    source.start(startTime);
    this.scheduledTime = startTime + buffer.duration;
    source.onended = () => this.scheduleNextBuffer();
  }
  stop() {
    this.audioQueue = [];
    this.isPlaying = false;
  }
}
class AudioVisualizer {
  constructor(audioContext, canvasId) {
    this.audioContext = audioContext;
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);
    this.isAnimating = false;
    this.draw = this.draw.bind(this);
  }
  connectSource(sourceNode) {
    sourceNode.connect(this.analyser);
  }
  start() {
    if (!this.isAnimating) {
      this.isAnimating = true;
      this.draw();
    }
  }
  stop() {
    this.isAnimating = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  draw() {
    if (!this.isAnimating) return;
    requestAnimationFrame(this.draw);
    this.analyser.getByteTimeDomainData(this.dataArray);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.lineWidth = 2;
    this.ctx.strokeStyle = document.body.classList.contains("dark-theme")
      ? "#e8f0fe"
      : "#1a73e8";
    this.ctx.beginPath();
    const sliceWidth = (this.canvas.width * 1.0) / this.bufferLength;
    let x = 0;
    for (let i = 0; i < this.bufferLength; i++) {
      const v = this.dataArray[i] / 128.0;
      const y = (v * this.canvas.height) / 2;
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }
    this.ctx.lineTo(this.canvas.width, this.canvas.height / 2);
    this.ctx.stroke();
  }
  cleanup() {
    this.stop();
    this.analyser?.disconnect();
  }
}

// 6. MEDIA MANAGERS (Camera, Screen)
class CameraManager {
  constructor(config) {
    this.config = {
      width: config.width || 640,
      quality: config.quality || 0.8,
    };
    this.isInitialized = false;
  }
  async initialize() {
    if (this.isInitialized) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    this.videoElement = document.createElement("video");
    this.videoElement.srcObject = this.stream;
    this.videoElement.playsInline = true;
    document.getElementById("cameraPreview").appendChild(this.videoElement);
    await this.videoElement.play();
    const ar = this.videoElement.videoHeight / this.videoElement.videoWidth;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.config.width;
    this.canvas.height = Math.round(this.config.width * ar);
    this.ctx = this.canvas.getContext("2d");
    this.isInitialized = true;
  }
  async capture() {
    if (!this.isInitialized) return null;
    this.ctx.drawImage(
      this.videoElement,
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );
    return this.canvas
      .toDataURL("image/jpeg", this.config.quality)
      .split(",")[1];
  }
  dispose() {
    this.stream?.getTracks().forEach((t) => t.stop());
    const preview = document.getElementById("cameraPreview");
    if (preview) preview.innerHTML = "";
    this.isInitialized = false;
  }
}
class ScreenManager {
  constructor(config) {
    this.config = {
      width: config.width || 1280,
      quality: config.quality || 0.8,
      onStop: config.onStop,
    };
    this.isInitialized = false;
  }
  async initialize() {
    if (this.isInitialized) return;
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
    });
    this.videoElement = document.createElement("video");
    this.videoElement.srcObject = this.stream;
    document.getElementById("screenPreview").appendChild(this.videoElement);
    await this.videoElement.play();
    const ar = this.videoElement.videoHeight / this.videoElement.videoWidth;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.config.width;
    this.canvas.height = Math.round(this.config.width * ar);
    this.ctx = this.canvas.getContext("2d");
    this.stream
      .getVideoTracks()[0]
      .addEventListener("ended", () => this.dispose());
    this.isInitialized = true;
  }
  async capture() {
    if (!this.isInitialized) return null;
    this.ctx.drawImage(
      this.videoElement,
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );
    return this.canvas
      .toDataURL("image/jpeg", this.config.quality)
      .split(",")[1];
  }
  dispose() {
    this.stream?.getTracks().forEach((t) => t.stop());
    const preview = document.getElementById("screenPreview");
    if (preview) preview.innerHTML = "";
    if (this.config.onStop) this.config.onStop();
    this.isInitialized = false;
  }
}

// 7. SETTINGS MANAGER
class SettingsManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.render();
    this.initializeElements();
    this.setupEventListeners();
    this.loadSettings();
  }
  render() {
    this.container.innerHTML = `
        <div class="settings-header">
            <button id="settingsSaveBtn" class="settings-save-btn">Save Settings</button>
        </div>
        <div class="settings-section">
            <h3>Configuration</h3>
            <div class="settings-grid">
                <div class="settings-group">
                    <label for="apiKey">Gemini API Key</label>
                    <input type="password" id="apiKey" placeholder="Enter your Gemini API key">
                </div>
                <div class="settings-group">
                    <label for="language">Language</label>
                    <select id="language">
                        <option value="en-US">English (US)</option>
                        <option value="es-ES">Spanish (Spain)</option>
                        <option value="fr-FR">French (France)</option>
                        <option value="de-DE">German (Germany)</option>
                        <option value="ja-JP">Japanese (Japan)</option>
                        <option value="hi-IN">Hindi (India)</option>
                    </select>
                </div>
                <div class="settings-group">
                    <label for="voice">Voice</label>
                    <select id="voice">
                        <option value="Puck">Puck</option>
                        <option value="Charon">Charon</option>
                        <option value="Kore">Kore</option>
                        <option value="Fenrir">Fenrir</option>
                        <option value="Aoede">Aoede</option>
                    </select>
                </div>
            </div>
        </div>
        <div class="settings-section">
            <h3>Model Parameters</h3>
            <div class="settings-grid">
                <div class="slider-group">
                    <label for="temperature">Temperature</label>
                    <input type="range" id="temperature" min="0" max="2" step="0.1">
                    <span id="temperatureValue"></span>
                </div>
                <div class="slider-group">
                    <label for="topP">Top P</label>
                    <input type="range" id="topP" min="0" max="1" step="0.05">
                    <span id="topPValue"></span>
                </div>
                <div class="slider-group">
                    <label for="topK">Top K</label>
                    <input type="range" id="topK" min="1" max="100" step="1">
                    <span id="topKValue"></span>
                </div>
                 <div class="slider-group">
                    <label for="sampleRate">Sample Rate</label>
                    <input type="range" id="sampleRate" min="8000" max="48000" step="1000">
                    <span id="sampleRateValue"></span>
                </div>
            </div>
        </div>
        <div class="settings-section">
            <h3>Media Quality</h3>
            <div class="settings-grid">
                <div class="slider-group">
                    <label for="fps">Capture FPS</label>
                    <input type="range" id="fps" min="1" max="10" step="1">
                    <span id="fpsValue"></span>
                </div>
                <div class="slider-group">
                    <label for="resizeWidth">Resize Width</label>
                    <input type="range" id="resizeWidth" min="320" max="1280" step="40">
                    <span id="resizeWidthValue"></span>
                </div>
                <div class="slider-group">
                    <label for="quality">JPEG Quality</label>
                    <input type="range" id="quality" min="0.1" max="1" step="0.1">
                    <span id="qualityValue"></span>
                </div>
            </div>
        </div>
        <hr>
        <div class="settings-group">
            <label for="systemInstructions">System Instructions</label>
            <textarea id="systemInstructions" rows="12"></textarea>
        </div>
        `;
  }
  initializeElements() {
    this.elements = {
      apiKeyInput: this.container.querySelector("#apiKey"),
      languageSelect: this.container.querySelector("#language"),
      voiceSelect: this.container.querySelector("#voice"),
      sampleRateInput: this.container.querySelector("#sampleRate"),
      sampleRateValue: this.container.querySelector("#sampleRateValue"),
      systemInstructionsInput: this.container.querySelector(
        "#systemInstructions"
      ),
      temperatureInput: this.container.querySelector("#temperature"),
      temperatureValue: this.container.querySelector("#temperatureValue"),
      topPInput: this.container.querySelector("#topP"),
      topPValue: this.container.querySelector("#topPValue"),
      topKInput: this.container.querySelector("#topK"),
      topKValue: this.container.querySelector("#topKValue"),
      fpsInput: this.container.querySelector("#fps"),
      fpsValue: this.container.querySelector("#fpsValue"),
      resizeWidthInput: this.container.querySelector("#resizeWidth"),
      resizeWidthValue: this.container.querySelector("#resizeWidthValue"),
      qualityInput: this.container.querySelector("#quality"),
      qualityValue: this.container.querySelector("#qualityValue"),
      saveBtn: this.container.querySelector("#settingsSaveBtn"),
    };
  }
  setupEventListeners() {
    this.elements.saveBtn.addEventListener("click", () => {
      this.saveSettings();
      // Using a custom alert for consistency
      document.dispatchEvent(
        new CustomEvent("show-alert", {
          detail: "Settings saved! Page will reload.",
        })
      );
      setTimeout(() => window.location.reload(), 2000);
    });
    Object.values(this.elements).forEach((el) => {
      if (el.type === "range")
        el.addEventListener("input", () => this.updateDisplayValues());
    });
  }
  loadSettings() {
    this.elements.apiKeyInput.value = localStorage.getItem("apiKey") || "";
    this.elements.languageSelect.value =
      localStorage.getItem("language") || "en-US";
    this.elements.voiceSelect.value =
      localStorage.getItem("voiceName") || "Puck";
    this.elements.sampleRateInput.value =
      localStorage.getItem("sampleRate") || "24000";
    this.elements.systemInstructionsInput.value =
      localStorage.getItem("systemInstructions") || DEFAULT_SYSTEM_INSTRUCTION;
    this.elements.temperatureInput.value =
      localStorage.getItem("temperature") || "0.9";
    this.elements.topPInput.value = localStorage.getItem("top_p") || "1.0";
    this.elements.topKInput.value = localStorage.getItem("top_k") || "32";
    this.elements.fpsInput.value = localStorage.getItem("fps") || "5";
    this.elements.resizeWidthInput.value =
      localStorage.getItem("resizeWidth") || "640";
    this.elements.qualityInput.value = localStorage.getItem("quality") || "0.7";

    this.updateDisplayValues();
  }
  saveSettings() {
    localStorage.setItem("apiKey", this.elements.apiKeyInput.value);
    localStorage.setItem("language", this.elements.languageSelect.value);
    localStorage.setItem("voiceName", this.elements.voiceSelect.value);
    localStorage.setItem("sampleRate", this.elements.sampleRateInput.value);
    localStorage.setItem(
      "systemInstructions",
      this.elements.systemInstructionsInput.value
    );
    localStorage.setItem("temperature", this.elements.temperatureInput.value);
    localStorage.setItem("top_p", this.elements.topPInput.value);
    localStorage.setItem("top_k", this.elements.topKInput.value);
    localStorage.setItem("fps", this.elements.fpsInput.value);
    localStorage.setItem("resizeWidth", this.elements.resizeWidthInput.value);
    localStorage.setItem("quality", this.elements.qualityInput.value);
  }
  updateDisplayValues() {
    this.elements.sampleRateValue.textContent = `${this.elements.sampleRateInput.value} Hz`;
    this.elements.temperatureValue.textContent =
      this.elements.temperatureInput.value;
    this.elements.topPValue.textContent = this.elements.topPInput.value;
    this.elements.topKValue.textContent = this.elements.topKInput.value;
    this.elements.fpsValue.textContent = `${this.elements.fpsInput.value} FPS`;
    this.elements.resizeWidthValue.textContent = `${this.elements.resizeWidthInput.value}px`;
    this.elements.qualityValue.textContent = this.elements.qualityInput.value;
  }
}

// 8. AGENT
class GeminiAgent extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.connected = false;
    this.client = null;
    this.mediaCaptureInterval = null;
  }
  async connectAndInitialize() {
    if (this.connected) return;
    const url = getWebsocketUrl();
    const config = getConfig();
    this.client = new GeminiWebsocketClient("GeminiAgent", url, config);
    try {
      await this.client.connect();
      this.connected = true;
      this.setupClientListeners();
      await this.initializeMedia();
      this.initialized = true;
      this.client.sendJSON({
        clientContent: {
          turns: [{ role: "user", parts: { text: "." } }],
          turnComplete: true,
        },
      }); // Initial ping
      console.log("Agent connected and initialized.");
    } catch (error) {
      console.error("Connection failed:", error);
      this.showAlert("Connection failed. Check API key and console.");
      this.disconnect();
      throw error;
    }
  }
  async initializeMedia() {
    this.audioContext = new AudioContext();
    this.audioStreamer = new AudioStreamer(this.audioContext);
    await this.audioStreamer.initialize();
    this.visualizer = new AudioVisualizer(this.audioContext, "visualizer");
    this.audioStreamer.gainNode.connect(this.visualizer.analyser);
    this.visualizer.start();
    this.audioRecorder = new AudioRecorder();
    const mediaConfig = {
      width: localStorage.getItem("resizeWidth") || 640,
      quality: localStorage.getItem("quality") || 0.7,
    };
    this.cameraManager = new CameraManager(mediaConfig);
    this.screenManager = new ScreenManager({
      ...mediaConfig,
      onStop: () => {
        this.stopMediaInterval();
        this.emit("screenshare_stopped");
      },
    });
  }
  setupClientListeners() {
    this.client.on("audio", (data) =>
      this.audioStreamer.streamAudio(new Uint8Array(data))
    );
    this.client.on("interrupted", () => this.audioStreamer.stop());
  }
  async startRecording() {
    if (!this.audioRecorder.isRecording)
      await this.audioRecorder.start((audioData) =>
        this.client.sendAudio(audioData)
      );
  }
  async toggleMic() {
    const micBtn = document.getElementById("micBtn");
    if (!this.audioRecorder.isRecording) {
      await this.startRecording();
      micBtn.classList.add("active");
    } else {
      const enabled = await this.audioRecorder.toggleMic();
      micBtn.classList.toggle("active", enabled);
    }
  }
  async startCameraCapture() {
    await this.cameraManager.initialize();
    this.startMediaInterval(async () => {
      const img = await this.cameraManager.capture();
      if (img) this.client.sendImage(img);
    });
  }
  stopCameraCapture() {
    this.stopMediaInterval();
    this.cameraManager.dispose();
  }
  async startScreenShare() {
    await this.screenManager.initialize();
    this.startMediaInterval(async () => {
      const img = await this.screenManager.capture();
      if (img) this.client.sendImage(img);
    });
  }
  stopScreenShare() {
    this.stopMediaInterval();
    if (this.screenManager && this.screenManager.isInitialized) {
      this.screenManager.dispose();
    }
  }
  startMediaInterval(callback) {
    this.stopMediaInterval();
    const fps = parseInt(localStorage.getItem("fps")) || 5;
    this.mediaCaptureInterval = setInterval(callback, 1000 / fps);
  }
  stopMediaInterval() {
    if (this.mediaCaptureInterval) clearInterval(this.mediaCaptureInterval);
  }
  disconnect() {
    this.client?.disconnect();
    this.audioRecorder?.stop();
    this.visualizer?.cleanup();
    this.cameraManager?.dispose();
    this.screenManager?.dispose();
    this.audioContext?.close();
    this.stopMediaInterval();
    this.connected = false;
    this.initialized = false;
    console.log("Agent disconnected.");
  }
  showAlert(message) {
    const alertBox = document.getElementById("custom-alert");
    alertBox.textContent = message;
    alertBox.classList.add("show");
    setTimeout(() => alertBox.classList.remove("show"), 3000);
  }
}

// 9. MAIN APP LOGIC
document.addEventListener("DOMContentLoaded", () => {
  const agent = new GeminiAgent();
  const settingsManager = new SettingsManager("settings-content");

  // Make showAlert globally accessible for the settings manager
  document.addEventListener("show-alert", (e) => agent.showAlert(e.detail));

  const tabs = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  const switchTab = (targetId) => {
    tabs.forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === targetId)
    );
    tabContents.forEach((c) => c.classList.toggle("active", c.id === targetId));
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetId = tab.dataset.tab;

      if (targetId === "live-content") {
        if (!localStorage.getItem("apiKey")) {
          agent.showAlert("Please set your Gemini API Key in Settings first.");
          switchTab("settings-content");
          return;
        }
        if (!agent.connected) {
          agent
            .connectAndInitialize()
            .then(() => {
              agent.toggleMic();
            })
            .catch(() => switchTab("home-content"));
        }
      }
      switchTab(targetId);
    });
  });

  document.getElementById("get-started-btn").addEventListener("click", () => {
    document.querySelector('.tab-btn[data-tab="live-content"]').click();
  });

  // Theme Toggle Logic
  const themeToggle = document.getElementById("theme-toggle");
  themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    const isDarkMode = document.body.classList.contains("dark-theme");
    localStorage.setItem("theme", isDarkMode ? "dark" : "light");
  });

  // Live Tab Controls
  let isCameraActive = false;
  let isScreenActive = false;

  agent.on("screenshare_stopped", () => {
    isScreenActive = false;
    document.getElementById("screenBtn").classList.remove("active");
  });

  document
    .getElementById("micBtn")
    .addEventListener("click", () => agent.toggleMic());
  document.getElementById("disconnectBtn").addEventListener("click", () => {
    agent.disconnect();
    switchTab("home-content");
    // Reset button states
    document
      .querySelectorAll(".live-control-btn.active")
      .forEach((b) => b.classList.remove("active"));
    isCameraActive = false;
    isScreenActive = false;
  });

  document.getElementById("cameraBtn").addEventListener("click", async () => {
    if (!agent.initialized) return;
    const btn = document.getElementById("cameraBtn");
    if (isScreenActive) return; // Prevent camera if screen is active
    isCameraActive = !isCameraActive;
    btn.classList.toggle("active", isCameraActive);
    if (isCameraActive) {
      await agent.startCameraCapture();
    } else {
      agent.stopCameraCapture();
    }
  });

  document.getElementById("screenBtn").addEventListener("click", async () => {
    if (!agent.initialized) return;
    const btn = document.getElementById("screenBtn");
    if (isCameraActive) return;

    if (!isScreenActive) {
      isScreenActive = true;
      btn.classList.add("active");
      try {
        await agent.startScreenShare();
      } catch (e) {
        console.error("Failed to start screen share:", e);
        isScreenActive = false;
        btn.classList.remove("active");
        agent.showAlert(
          "Screen share permission was denied or failed to start."
        );
      }
    } else {
      agent.stopScreenShare();
    }
  });
});
// --- END: Inlined & Refactored JavaScript ---
