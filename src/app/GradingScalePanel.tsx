import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type GradeBand = { grade: string; minimum: string; maximum: string };
type GradeBandRow = { grade: string; minimum_percentage: number; maximum_percentage: number; configuration_version: number };

function parseBands(value: unknown): GradeBandRow[] | null {
  if (!Array.isArray(value)) return null;
  const bands: GradeBandRow[] = [];
  for (const row of value) {
    if (typeof row !== 'object' || row === null
      || !('grade' in row) || typeof row.grade !== 'string'
      || !('minimum_percentage' in row) || typeof row.minimum_percentage !== 'number'
      || !('maximum_percentage' in row) || typeof row.maximum_percentage !== 'number'
      || !('configuration_version' in row) || typeof row.configuration_version !== 'number') {
      return null;
    }
    bands.push({
      grade: row.grade,
      minimum_percentage: row.minimum_percentage,
      maximum_percentage: row.maximum_percentage,
      configuration_version: row.configuration_version,
    });
  }
  return bands;
}

export default function GradingScalePanel() {
  const [bands, setBands] = useState<GradeBand[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadBands() {
      if (!supabase) {
        setError('School database is not configured.');
        setIsLoading(false);
        return;
      }
      try {
        const { data, error: loadError } = await supabase
          .from('grading_bands')
          .select('grade,minimum_percentage,maximum_percentage,configuration_version')
          .order('configuration_version')
          .order('minimum_percentage');
        if (cancelled) return;
        if (loadError) {
          setError('The grading scale could not be loaded.');
          return;
        }
        const parsed = parseBands(data);
        if (!parsed || parsed.length === 0) {
          setError('The grading scale is empty or returned unexpected data.');
          return;
        }
        const latestVersion = Math.max(...parsed.map((band) => band.configuration_version));
        setCurrentVersion(latestVersion);
        setBands(parsed
          .filter((band) => band.configuration_version === latestVersion)
          .map((band) => ({
            grade: band.grade,
            minimum: band.minimum_percentage.toFixed(2).replace(/\.00$/, ''),
            maximum: band.maximum_percentage.toFixed(2).replace(/\.00$/, ''),
          })));
      } catch {
        if (!cancelled) setError('The grading scale could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadBands();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateBand(index: number, key: keyof GradeBand, value: string) {
    setBands((current) => current.map((band, bandIndex) => (
      bandIndex === index ? { ...band, [key]: value } : band
    )));
  }

  async function saveScale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || isSaving || bands.length === 0) return;
    const parsedBands = bands.map((band) => ({
      grade: band.grade.trim(),
      minimum_percentage: Number(band.minimum),
      maximum_percentage: Number(band.maximum),
    }));
    if (parsedBands.some((band) => !band.grade
      || !Number.isFinite(band.minimum_percentage)
      || !Number.isFinite(band.maximum_percentage))) {
      setError('Every grade band needs a name and numeric percentage bounds.');
      return;
    }
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const { data, error: saveError } = await supabase.rpc('save_grading_scale', {
        p_bands: parsedBands,
      });
      if (saveError || typeof data !== 'number') {
        setError('The grading scale must use unique grade names and cover 0–100 without gaps or overlaps.');
        return;
      }
      setCurrentVersion(data);
      setMessage(`Grading scale saved as version ${data}. Earlier scales remain available for historical report records.`);
    } catch {
      setError('The grading scale could not be saved. Check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="family-panel grading-scale-panel" aria-labelledby="grading-scale-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">School grading</span>
          <h2 id="grading-scale-heading">Grading scale</h2>
        </div>
        {currentVersion > 0 && <span className="attendance-count">Version {currentVersion}</span>}
      </div>
      {isLoading ? (
        <p className="empty-state">Loading grading scale…</p>
      ) : (
        <form className="grading-scale-form" onSubmit={(event) => void saveScale(event)}>
          <p className="provisioning-context">
            Each version is retained. Bands must cover 0 through 100 with no gaps or overlaps;
            published report cards keep their original grade snapshots.
          </p>
          <div className="grading-band-list">
            {bands.map((band, index) => (
              <div className="grading-band-row" key={`band-${index}`}>
                <label>
                  <span className="field-label">Grade</span>
                  <input
                    className="text-field"
                    maxLength={8}
                    onChange={(event) => updateBand(index, 'grade', event.target.value)}
                    required
                    value={band.grade}
                  />
                </label>
                <label>
                  <span className="field-label">Minimum %</span>
                  <input
                    className="text-field"
                    max="100"
                    min="0"
                    onChange={(event) => updateBand(index, 'minimum', event.target.value)}
                    required
                    step="0.01"
                    type="number"
                    value={band.minimum}
                  />
                </label>
                <label>
                  <span className="field-label">Maximum %</span>
                  <input
                    className="text-field"
                    max="100"
                    min="0"
                    onChange={(event) => updateBand(index, 'maximum', event.target.value)}
                    required
                    step="0.01"
                    type="number"
                    value={band.maximum}
                  />
                </label>
                <button
                  className="sign-out-button remove-grade-band"
                  disabled={bands.length <= 1 || isSaving}
                  onClick={() => setBands((current) => current.filter((_, bandIndex) => bandIndex !== index))}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="grading-scale-actions">
            <button
              className="sign-out-button"
              disabled={bands.length >= 12 || isSaving}
              onClick={() => setBands((current) => [...current, { grade: '', minimum: '', maximum: '' }])}
              type="button"
            >
              Add grade band
            </button>
            <button className="sign-in-button" disabled={isSaving || bands.length === 0} type="submit">
              <span>{isSaving ? 'Saving grading scale…' : 'Save new grading version'}</span>
            </button>
          </div>
        </form>
      )}
      {error && <p className="form-notice academic-notice" role="alert">{error}</p>}
      {message && <p className="success-notice academic-notice" role="status">{message}</p>}
    </section>
  );
}
