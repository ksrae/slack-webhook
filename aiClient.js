import { OpenAI } from 'openai';
import { AzureKeyCredential } from '@azure/core-auth';
import createAzureClient from '@azure-rest/ai-inference';
import { createSseStream } from '@azure/core-sse';
import { Mistral } from '@mistralai/mistralai';
import { GoogleGenerativeAI } from "@google/generative-ai";

class AIClient {
  constructor(config) {
    this.model = config.model;
    this.apiKey = this.model === 'gemini' ? config.geminikey : config.key;
    this.endpoint = config.endpoint;
    this.conversationHistory = [];
    this.assistant = this.model === 'gemini' ? 'model' : 'assistant';

    // 대화 히스토리 초기화
    if(this.model !== 'gemini') {
      this.conversationHistory.push(
        { role: 'system', content: 'You are a helpful assistant.' }
      );
    }
    
    
    if (this.model === 'gpt-4o') {
      this.client = new OpenAI({ baseURL: this.endpoint, apiKey: this.apiKey });
    } else if (this.model === 'llama') {
      this.client = createAzureClient(this.endpoint, new AzureKeyCredential(this.apiKey));
    } else if (this.model === 'mistral') {
      this.client = new Mistral({ apiKey: this.apiKey, serverURL: this.endpoint });
    } else if (this.model === 'gemini') {
      this.client = new GoogleGenerativeAI(this.apiKey);
    } else {
      throw new Error('Unsupported AI model.');
    }
  }

  async getResponse(userQuery, sendProgress) {
    if(this.model === 'gemini') {
      this.conversationHistory.push({ role: 'user', parts: [{ text: userQuery }] });      
    } else {
      this.conversationHistory.push({ role: 'user', content: userQuery });
    }
    
  
    let buffer = ''; // 조합 중인 버퍼
    const sentenceEndings = ['.', '!', '?', '\n', '…', 'ㅋㅋ', 'ㅎㅎ', '~~']; // 문장 끝 감지 패턴
  
    const processBuffer = () => {
      let lastIndex = -1;
  
      // 문장 끝 찾기
      for (const ending of sentenceEndings) {
        const index = buffer.lastIndexOf(ending);
        if (index > lastIndex) {
          lastIndex = index;
        }
      }
  
      // 완성된 문장을 분리
      if (lastIndex !== -1) {
        const completeSentence = buffer.slice(0, lastIndex + 1).trim();
        buffer = buffer.slice(lastIndex + 1).trim(); // 나머지 텍스트는 버퍼에 저장
        return completeSentence;
      }
  
      return null; // 완성된 문장이 없음
    };
  
    const processResponse = async (chunk, sendProgress) => {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        buffer += content;
  
        let sentence;
        while ((sentence = processBuffer()) !== null) {
          sendProgress(sentence);
          this.conversationHistory.push({ role: this.assistant, content: sentence });
        }
      }
    };
  
    try {
      if (this.model === 'gpt-4o') {
        const stream = await this.client.chat.completions.create({
          messages: this.conversationHistory,
          model: this.model,
          stream: true,
          max_tokens: 1000,
          temperature: 1.0,
          top_p: 1.0,
        });
  
        for await (const chunk of stream) {
          await processResponse(chunk, sendProgress);
        }
      } else if (this.model === 'llama') {
        const response = await this.client.path('/chat/completions').post({
          body: {
            messages: this.conversationHistory,
            model: 'Llama-3.3-70B-Instruct',
            stream: true,
            temperature: 1.0,
            top_p: 1.0,
            max_tokens: 1000,
          },
        }).asNodeStream();
  
        const stream = response.body;
        if (!stream) throw new Error('The response stream is undefined');
  
        const sseStream = createSseStream(stream);
  
        for await (const event of sseStream) {
          if (event.data === '[DONE]') break;
  
          const jsonData = event.data.replace(/^data:\s*/, '');
          if (jsonData === '[DONE]') break;
  
          let data;
          try {
            data = JSON.parse(jsonData);
          } catch (err) {
            console.error('Error parsing JSON:', err);
            continue;
          }
  
          for (const choice of data.choices) {
            await processResponse(choice, sendProgress);
          }
        }
      } else if (this.model === 'mistral') {
        const stream = await this.client.chat({
          model: 'mistral-medium',
          messages: this.conversationHistory,
          stream: true,
          max_tokens: 1000,
          temperature: 1.0,
          top_p: 1.0,
        });

        for await (const chunk of stream) {
          await processResponse(chunk, sendProgress);
        }
      } else if (this.model === 'gemini') {
        const model = this.client.getGenerativeModel({ 
          model: "gemini-1.5-flash", 
          systemInstruction: "You are a helpful assistant that remembers previous messages and provides context-aware responses.",
        });

        const chat = model.startChat({
          history: this.conversationHistory,
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 1.0,
            topP: 1.0,
          },
        });


        
          // Gemini로 메시지 전송
          const result = await chat.sendMessageStream(userQuery);
          const response = await result.stream;

          console.log({response});
                  // const stream = response.body;
          // if (!stream) throw new Error('The response stream is undefined');

          // 응답 텍스트를 처리
          // const text = response.text();
          // sendProgress(text);
        
          // 모델 응답을 히스토리에 추가
          // this.conversationHistory.push({ role: "model", parts: [{ text }] });

    
          // const stream = response.body;
          // if (!stream) throw new Error('The response stream is undefined');
    
          // const sseStream = createSseStream(stream);
    
          // for await (const event of sseStream) {
          //   if (event.data === '[DONE]') break;
    
          //   const jsonData = event.data.replace(/^data:\s*/, '');
          //   if (jsonData === '[DONE]') break;
    
          //   let data;
          //   try {
          //     data = JSON.parse(jsonData);
          //   } catch (err) {
          //     console.error('Error parsing JSON:', err);
          //     continue;
          //   }
    
          //   for (const choice of data.choices) {
          //     await processResponse(choice, sendProgress);
          //   }
          // }
      }
      
  
      // 남은 텍스트도 처리
      if (buffer.trim()) {
        sendProgress(buffer);
      
        const historyEntry = this.model === 'gemini'
          ? { role: this.assistant, parts: [{ text: buffer }] }
          : { role: this.assistant, content: buffer };
      
        this.conversationHistory.push(historyEntry);
      }

      this.conversationHistory.forEach((entry) => {
        console.log(`${entry.role}: ${entry.parts[0].text}`);
      });

    } catch (error) {
      console.error('Error fetching AI response:', error);
      sendProgress('Error occurred while generating a response.');
    }
  
  }
}

export default AIClient;
