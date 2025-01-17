import { OpenAI } from 'openai';
import { AzureKeyCredential } from '@azure/core-auth';
import createAzureClient from '@azure-rest/ai-inference';
import { createSseStream } from '@azure/core-sse';
import { Mistral } from '@mistralai/mistralai';

class AIClient {
  constructor(config) {
    this.model = config.model;
    this.apiKey = config.key;
    this.endpoint = config.endpoint;

    // 대화 히스토리 초기화
    this.conversationHistory = [
      { role: 'system', content: 'You are a helpful assistant.' }
    ];

    if (this.model === 'gpt-4o') {
      this.client = new OpenAI({ baseURL: this.endpoint, apiKey: this.apiKey });
    } else if (this.model === 'llama') {
      this.client = createAzureClient(this.endpoint, new AzureKeyCredential(this.apiKey));
    } else if (this.model === 'mistral') {
      this.client = new Mistral({ apiKey: this.apiKey, serverURL: this.endpoint });
    } else {
      throw new Error('Unsupported AI model.');
    }
  }

  async getResponse(userQuery, sendProgress) {
    // 사용자의 질문을 대화 히스토리에 추가
    this.conversationHistory.push({ role: 'user', content: userQuery });

    let buffer = ''; // 문장을 조합할 버퍼

    if (this.model === 'gpt-4o') {
      try {
        const stream = await this.client.chat.completions.create({
          messages: this.conversationHistory,
          model: this.model,
          stream: true,
          max_tokens: 1000,
          temperature: 1.0,
          top_p: 1.0,
        });

        // Process stream and send data to Slack incrementally
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            buffer += content; // 버퍼에 추가

            // 문장 끝을 찾고 출력
            let lastIndex = -1;
            const sentenceEndings = ['.', '!', '?', '\n'];
            for (const ending of sentenceEndings) {
              const index = buffer.lastIndexOf(ending);
              if (index > lastIndex) {
                lastIndex = index;
              }
            }

            // 문장이 끝나면 출력
            if (lastIndex !== -1) {
              const completeSentence = buffer.slice(0, lastIndex + 1);
              sendProgress(completeSentence); // console.log 대신 sendProgress 호출

              // assistant의 응답을 대화 히스토리에 추가
              this.conversationHistory.push({ role: 'assistant', content: completeSentence });

              buffer = buffer.slice(lastIndex + 1); // 남은 텍스트는 버퍼에 저장
            }
          }
        }
      } catch (error) {
        console.error('Error fetching GPT response:', error);
        sendProgress('Error occurred while generating a response.');
      }
    } else if (this.model === 'llama') {
      try {
        const response = await this.client.path('/chat/completions').post({
          body: {
            messages: this.conversationHistory, // 대화 히스토리 포함
            model: 'Llama-3.3-70B-Instruct',
            stream: true,
            temperature: 1.0,
            top_p: 1.0,
            max_tokens: 1000,
          }
        }).asNodeStream();

        const stream = response.body;

        if (!stream) {
          throw new Error("The response stream is undefined");
        }

        const sseStream = createSseStream(stream);

        for await (const event of sseStream) {

          if (event.data === "[DONE]") {
            console.log('Stream finished');
            break;  // 스트림 종료
          }

          // "data: " 부분을 제거하고 나서 JSON 파싱
          const jsonData = event.data.replace(/^data:\s*/, ''); // "data: " 제거
          
          if (jsonData === '[DONE]') {
            break;
          }

          let data;
          try {
            data = JSON.parse(jsonData);  // JSON 파싱
          } catch (err) {
            console.error('Error parsing JSON:', err);
            continue;
          }

          for (const choice of data.choices) {
            const content = choice.delta?.content || '';
            if (content) {
              buffer += content; // 이어 붙임

              // 문장 끝을 찾고 출력
              let lastIndex = -1;
              const sentenceEndings = ['.', '!', '?', '\n'];
              for (const ending of sentenceEndings) {
                const index = buffer.lastIndexOf(ending);
                if (index > lastIndex) {
                  lastIndex = index;
                }
              }

              // 문장이 끝나면 출력
              if (lastIndex !== -1) {
                const completeSentence = buffer.slice(0, lastIndex + 1);
                sendProgress(completeSentence); // console.log 대신 sendProgress 호출

                // assistant의 응답을 대화 히스토리에 추가
                this.conversationHistory.push({ role: 'assistant', content: completeSentence });

                buffer = buffer.slice(lastIndex + 1); // 남은 텍스트는 버퍼에 저장
              }
            }
          }
        }

        // 스트림 종료 후 남은 텍스트도 출력
        if (buffer.trim()) {
          sendProgress(buffer);

          // 남은 응답도 대화 히스토리에 추가
          this.conversationHistory.push({ role: 'assistant', content: buffer });
        }
      } catch (error) {
        console.error('Error fetching LLaMA response:', error);
        sendProgress('Error occurred while generating a response.');
      }
    }
  }
}

export default AIClient;
