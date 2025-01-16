const { OpenAI } = require('openai');
const { AzureKeyCredential } = require('@azure/core-auth');
const { default: createAzureClient } = require('@azure-rest/ai-inference');
const { Mistral } = require('@mistralai/mistralai'); // Mistral AI 클라이언트를 위한 임포트

class AIClient {
  constructor(config) {
    this.model = config.model;
    this.apiKey = config.key;
    this.endpoint = config.endpoint;

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

  async getResponse(userQuery) {
    if (this.model === 'gpt-4o') {
      // GPT-4o 처리 로직
      try {
        const response = await this.client.chat.completions.create({
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: userQuery }
          ],
          temperature: 1.0,
          top_p: 1.0,
          max_tokens: 1000,
          model: this.model
        });

        return response.choices[0].message.content;
      } catch (error) {
        console.error('Error fetching GPT response:', error);
        return 'Error occurred while generating a response.';
      }
    } else if (this.model === 'llama') {
      try {
        const response = await this.client.path('/chat/completions').post({
          body: {
            messages: [
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: userQuery }
            ],
            temperature: 1.0,
            top_p: 1.0,
            max_tokens: 1000,
            model: 'Llama-3.3-70B-Instruct'
          }
        });
    
        const content = response.body.choices[0].message.content;
        return content;
        
      } catch (error) {
        console.error('Error fetching LLaMA response:', error);
        return 'Error occurred while generating a response.';
      }
    } else if (this.model === 'mistral') {
      try {
        const response = await this.client.chat.complete({
          model: "Mistral-large-2411", // 혹은 사용하고자 하는 Mistral 모델 이름
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: userQuery }
          ],
          temperature: 1.0,
          max_tokens: 1000,
          top_p: 1.0
        });

        if (response.choices && response.choices[0]?.message?.content) {
          return response.choices[0].message.content;
        } else {
          console.error('Error: Mistral response does not contain expected content');
          return 'Mistral API returned an invalid response.';
        }
      } catch (error) {
        console.error('Error fetching Mistral response:', error);
        return 'Error occurred while generating a response.';
      }
    }   
  }    
}

module.exports = AIClient;
