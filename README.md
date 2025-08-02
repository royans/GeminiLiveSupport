# GeminiLiveSupport

Welcome to the Technical Support Assistant, a powerful, real-time multimodal chat demo application powered by the Google Gemini API. This application is currently setup to serve as an expert on Google Workspace products, allowing users to interact with it through voice, screen sharing, and camera input for a seamless support experience.

## 🚀 Features

* **Real-time Multimodal Interaction:** Engage in a live conversation with Gemini using your microphone for voice input.
* **Screen & Camera Sharing:** Share your screen or camera feed to provide visual context for your support questions, allowing the assistant to guide you through steps visually.
* **Google Search Grounding:** Responses are grounded with up-to-date information from Google Search, ensuring accuracy and relevance.
* **Multi-language Support:** Interact with the assistant in various languages, with spoken responses delivered in your selected language.
* **Customizable Experience:**
    * Adjustable model parameters (temperature, Top P, Top K).
    * Configurable media quality settings (FPS, resolution).
    * Customizable system instructions to tailor the assistant's personality and expertise.
* **Elegant & Responsive UI:**
    * A clean, tab-based interface that works beautifully on both desktop and mobile devices.
    * Includes both light and dark modes to suit your preference.

## 🛠️ Setup and Usage

To run this application, you only need a modern web browser and a Gemini API key.

1.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/royans/GeminiLiveSupport/link.git](https://github.com/royans/GeminiLiveSupport/link.git)
    cd GeminiLiveSupport
    ```

2.  **Open `index.html`:** Open the `index.html` file in your web browser.

3.  **Enter API Key:**
    * Navigate to the **Settings** tab.
    * Enter your Google Gemini API Key in the designated field. You can obtain a key from [Google AI for Developers](https://ai.google.dev/).

4.  **Configure (Optional):**
    * Adjust the language, voice, model parameters, and media quality to your liking.
    * Click **"Save and Reload"** for the settings to take effect.

5.  **Start the Conversation:**
    * Navigate to the **Live** tab. The microphone will be activated automatically.
    * Start speaking! Use the on-screen controls to toggle your microphone, camera, or screen share.

## 🙏 Acknowledgements

This application was built upon the great work of others in the open-source community. It simplifies and combines concepts from two primary sources:

* **[Gemini 2.0 Flash Multimodal Live API Client](https://github.com/ViaAnthroposBenevolentia/gemini-2-live-api-demo)** by ChrisKyle.
* **[live-api-web-console](https://github.com/google-gemini/live-api-web-console)** by the Google-Gemini team.

Special thanks to **Nishanth Tharakan** for his invaluable help in getting this project working.

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
