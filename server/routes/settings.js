import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');

const DEFAULT_SETTINGS = {
  snapshotInterval: 60,
};

const VALID_INTERVALS = [0, 1, 2, 3, 5, 15, 60];

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.error('[Settings] Error loading settings:', err.message);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

router.get('/', (req, res) => {
  const settings = loadSettings();
  res.json(settings);
});

router.put('/', (req, res) => {
  try {
    const { snapshotInterval } = req.body;

    if (snapshotInterval !== undefined) {
      const interval = Number(snapshotInterval);
      if (!VALID_INTERVALS.includes(interval)) {
        return res.status(400).json({
          error: `Invalid snapshot interval. Must be one of: ${VALID_INTERVALS.join(', ')} (0 = trade level)`
        });
      }
    }

    const current = loadSettings();
    const updated = { ...current };

    if (snapshotInterval !== undefined) {
      updated.snapshotInterval = Number(snapshotInterval);
    }

    saveSettings(updated);
    res.json(updated);
  } catch (error) {
    console.error('[Settings] Error saving settings:', error);
    res.status(500).json({ error: error.message });
  }
});

export function getSnapshotIntervalSeconds() {
  const settings = loadSettings();
  return settings.snapshotInterval * 60;
}

export default router;
