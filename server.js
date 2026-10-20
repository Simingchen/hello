const express = require('express');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const TESTS_DIR = path.join(__dirname, 'tests');
const STORAGE_DIR = path.join(__dirname, 'storage');
const VIDEOS_DIR = path.join(__dirname, 'videos');

[TESTS_DIR, STORAGE_DIR, VIDEOS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const LANG_EXT = {
  javascript: 'js',
  python: 'py',
  java: 'java',
  csharp: 'cs',
};

// 启动录制（保持不变）
app.post('/api/start-test', (req, res) => {
  const { testName, targetUrl, language = 'javascript', useStorage = false } = req.body;

  if (!testName || !targetUrl) {
    return res.status(400).json({ error: '缺少测试名称或目标URL' });
  }

  const ext = LANG_EXT[language] || 'js';
  const safeName = testName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
  const filename = `${safeName}_${uuidv4().slice(0, 8)}.${ext}`;
  const outputPath = path.join(TESTS_DIR, filename);

  const args = ['playwright', 'codegen', '--target', language, '-o', outputPath];

  const storageFile = path.join(STORAGE_DIR, 'auth.json');
  if (useStorage) {
    if (fs.existsSync(storageFile)) {
      args.push('--load-storage', storageFile);
    }
    args.push('--save-storage', storageFile);
  }

  args.push(targetUrl);

  const child = spawn('npx', args, {
    stdio: 'inherit',
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
  });

  child.on('close', (code) => {
    if (code === 0) {
      const content = fs.readFileSync(outputPath, 'utf-8');
      res.json({ success: true, filename, content });
    } else {
      res.status(500).json({ error: `codegen 退出码: ${code}` });
    }
  });

  child.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
});

// 列出测试文件
app.get('/api/tests', (req, res) => {
  const files = fs.readdirSync(TESTS_DIR)
    .filter(f => /\.(js|py|java|cs)$/.test(f))
    .map(name => {
      const filePath = path.join(TESTS_DIR, name);
      const stat = fs.statSync(filePath);
      const base = name.replace(/\.[^.]+$/, '');
      const videoName = base + '.webm';
      const videoPath = path.join(VIDEOS_DIR, videoName);
      return {
        name,
        size: stat.size,
        mtime: stat.mtime,
        hasVideo: fs.existsSync(videoPath),
        videoName,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  res.json(files);
});

// 下载文件
app.get('/api/tests/:filename', (req, res) => {
  const filePath = path.join(TESTS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  res.download(filePath);
});

// 获取单个测试文件内容
app.get('/api/tests/:filename/content', (req, res) => {
  const filePath = path.join(TESTS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  res.json({ content: fs.readFileSync(filePath, 'utf-8') });
});

// 编辑保存测试文件
app.post('/api/tests/:filename', (req, res) => {
  const { content } = req.body;
  const filePath = path.join(TESTS_DIR, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }

  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content 必须是字符串' });
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  res.json({ success: true });
});

// 回放并录制视频
app.post('/api/tests/:filename/replay', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(TESTS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }

  const base = filename.replace(/\.[^.]+$/, '');
  const videoPath = path.join(VIDEOS_DIR, base + '.webm');
  const ext = path.extname(filename).toLowerCase();

  let command;
  let args;

  if (ext === '.js') {
    command = 'node';
    args = [filePath];
  } else if (ext === '.py') {
    command = 'python3';
    args = [filePath];
  } else if (ext === '.java') {
    command = 'java';
    args = [filePath];
  } else if (ext === '.cs') {
    command = 'dotnet';
    args = ['run', '--project', filePath];
  } else {
    return res.status(400).json({ error: '暂不支持该语言回放' });
  }

  const child = spawn(command, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ':0',
      REPLAY_VIDEO_PATH: videoPath,
    },
  });

  child.on('close', (code) => {
    if (code === 0 && fs.existsSync(videoPath)) {
      res.json({ success: true, videoName: path.basename(videoPath) });
    } else if (code === 0) {
      res.json({ success: true, videoName: null, message: '回放完成，但未生成视频' });
    } else {
      res.status(500).json({ error: `回放退出码: ${code}` });
    }
  });

  child.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
});

// 删除测试用例及其视频
app.delete('/api/tests/:filename', (req, res) => {
  const filePath = path.join(TESTS_DIR, req.params.filename);
  const base = req.params.filename.replace(/\.[^.]+$/, '');
  const videoPath = path.join(VIDEOS_DIR, base + '.webm');

  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

  res.json({ success: true });
});

app.listen(3000, () => {
  console.log('服务已启动: http://localhost:3000');
});