import pkg from '@slack/bolt';
const { App } = pkg;
import AIClient from './aiClient.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Slack 정보 읽기
const getSlackInfo = () => {
  const filePath = path.join(__dirname, 'slack_info.json');
  const jsonData = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(jsonData);
};

const slackInfo = getSlackInfo();

// 환경 변수에서 설정 읽기
const SLACK_BOT_TOKEN = slackInfo.chatbot.botToken;
const SLACK_APP_TOKEN = slackInfo.chatbot.appToken;
const AI_CONFIG = slackInfo.ai;

// AI 클라이언트 초기화
const aiClient = new AIClient(AI_CONFIG);

// Bolt 앱 초기화
const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN, // Socket Mode를 위해 필요
  socketMode: true // Socket Mode 활성화
});

// `app_mention` 이벤트 핸들러
app.event('app_mention', async ({ event, say }) => {
  try {
    const message = event?.text.replace(/<[^>]*>/g, '').trim(); // Slack 메시지에서 태그 제거
    console.log('Received message:', message);

    // 응답을 실시간으로 처리하는 함수
    const sendProgress = (text) => {
      if(text) {
        say(text); // Slack에 실시간으로 메시지 전송
      }
    };

    // AI 응답 생성 (스트리밍)
    await aiClient.getResponse(message, sendProgress);

  } catch (error) {
    console.error('Error handling app_mention event:', error);
    await say('Something went wrong. Please try again later.');
  }
});

// 앱 실행
(async () => {
  try {
    await app.start();
    console.log('⚡️ Bolt app is running!');
  } catch (error) {
    console.error('Unable to start the app:', error);
  }
})();
