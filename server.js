const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const stream = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

// multer 설정
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Slack 정보 읽기
const getSlackInfo = () => {
    const filePath = path.join(__dirname, 'slack_info.txt');
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const token = lines[0].trim();
    const channelId = lines[1].trim();
    return { token, channelId };
};

const { token: SLACK_TOKEN, channelId: SLACK_CHANNEL_ID } = getSlackInfo();

const getWebhookUrl = () => {
    const filePath = path.join(__dirname, 'webhook.txt');
    return fs.readFileSync(filePath, 'utf8').trim();
};

// HTML 파일을 제공하는 라우트
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// URL 전송 처리
app.post('/send-url', async (req, res) => {
    const { url } = req.body;

    try {
        const webhookUrl = getWebhookUrl();
        const payload = {
            text: `새 웹사이트 주소가 입력되었습니다: ${url}`
        };

        await axios.post(webhookUrl, payload);
        res.status(200).send('URL이 전송되었습니다.');
    } catch (error) {
        console.error('URL 전송 실패:', error);
        res.status(500).send('URL 전송에 실패했습니다.');
    }
});

// 파일 업로드 로직
async function uploadFileToSlack(file) {
    try {
        // Step 1: Get Upload URL
        const urlResponse = await axios.get('https://slack.com/api/files.getUploadURLExternal', {
            headers: {
                Authorization: `Bearer ${SLACK_TOKEN}`
            },
            params: {
                filename: file.originalname,
                length: file.size
            }
        });

        if (!urlResponse.data.ok) {
            throw new Error(`Failed to get upload URL: ${urlResponse.data.error}`);
        }

        const { upload_url, file_id } = urlResponse.data;

        // Step 2: Upload file to URL
        const bufferStream = new stream.PassThrough();
        bufferStream.end(file.buffer);

        const formData = new FormData();
        formData.append('file', bufferStream, {
            filename: file.originalname,
            contentType: file.mimetype,
            knownLength: file.size,
        });

        await axios.post(upload_url, formData, {
            headers: {
                ...formData.getHeaders(),
            },
        });

        // Step 3: Complete Upload
        const completeResponse = await axios.post(
            'https://slack.com/api/files.completeUploadExternal',
            {
                files: [
                    {
                        id: file_id,
                        title: file.originalname
                    }
                ],
                channel_id: SLACK_CHANNEL_ID
            },
            {
                headers: {
                    Authorization: `Bearer ${SLACK_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!completeResponse.data.ok) {
            if (completeResponse.data.error === 'not_in_channel') {
                throw new Error(`Bot is not in the channel. Please invite the bot to the channel.`);
            }
            throw new Error(`Failed to complete upload: ${completeResponse.data.error}`);
        }

        return {
            filename: file.originalname,
            success: true,
        };
    } catch (error) {
        console.error(`Failed to upload ${file.originalname}:`, error.message);
        return {
            filename: file.originalname,
            success: false,
            error: error.message,
        };
    }
}

// 파일 전송 처리
app.post('/send-files', upload.array('files'), async (req, res) => {
    try {
        const uploadResults = await Promise.all(req.files.map(uploadFileToSlack));

        const allSuccessful = uploadResults.every(result => result.success);
        if (allSuccessful) {
            res.status(200).json({
                message: '모든 파일이 성공적으로 업로드되었습니다.',
                results: uploadResults
            });
        } else {
            res.status(207).json({
                message: '일부 또는 모든 파일 업로드에 실패했습니다.',
                results: uploadResults
            });
        }
    } catch (error) {
        console.error('파일 전송 실패:', error);
        res.status(500).json({
            message: '파일 전송에 실패했습니다.',
            error: error.message
        });
    }
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT}에서 실행 중입니다.`);
});
