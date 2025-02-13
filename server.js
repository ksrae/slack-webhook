import express from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import stream from 'stream';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// multer 설정
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Slack 정보 읽기
const getSlackInfo = () => {
    const filePath = path.join(__dirname, 'slack_info.json');
    const jsonData = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(jsonData);
};

const allSlackInfo = getSlackInfo();

// HTML 파일을 제공하는 라우트
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// URL 전송 처리
app.post('/send-url', async (req, res) => {
    const { url } = req.body;

    try {
        const webhookUrl = allSlackInfo["pushpush"]["webhookUrl"];
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
        // 파일명 디코딩
        const originalName = decodeURIComponent(file.originalname); // 파일명을 UTF-8 디코딩
        console.log(`디코딩된 파일명: ${originalName}`);

        // Step 1: Get Upload URL
        const urlResponse = await axios.get('https://slack.com/api/files.getUploadURLExternal', {
            headers: {
                Authorization: `Bearer ${allSlackInfo["pushpush"]["token"]}`,
            },
            params: {
                filename: originalName, // 디코딩된 파일명 사용
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

        const encodedFilename = encodeURIComponent(originalName); // 다시 인코딩 처리 (Slack API 요구사항에 맞출 경우 필요)

        const formData = new FormData();
        formData.append('file', bufferStream, {
            filename: encodedFilename, // 다시 인코딩된 파일명을 전달
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
                        title: originalName // 디코딩된 원본 파일명 유지
                    }
                ],
                channel_id: allSlackInfo["pushpush"]["channelId"]
            },
            {
                headers: {
                    Authorization: `Bearer ${allSlackInfo["pushpush"]["token"]}`,
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
            filename: originalName,
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
