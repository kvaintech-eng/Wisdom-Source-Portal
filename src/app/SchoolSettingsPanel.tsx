import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type ContactDetails = Record<string, unknown>;

type SettingsRecord = {
  school_name: string;
  contact_details: ContactDetails;
  report_card_footer: string;
  watermark_object_path: string | null;
  signature_object_path: string | null;
  configuration_version: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSettings(value: unknown): SettingsRecord | null {
  if (!isRecord(value)
    || typeof value.school_name !== 'string'
    || !isRecord(value.contact_details)
    || typeof value.report_card_footer !== 'string'
    || (value.watermark_object_path !== null && typeof value.watermark_object_path !== 'string')
    || (value.signature_object_path !== null && typeof value.signature_object_path !== 'string')
    || typeof value.configuration_version !== 'number') {
    return null;
  }
  return {
    school_name: value.school_name,
    contact_details: value.contact_details,
    report_card_footer: value.report_card_footer,
    watermark_object_path: value.watermark_object_path,
    signature_object_path: value.signature_object_path,
    configuration_version: value.configuration_version,
  };
}

function contactValue(contactDetails: ContactDetails, key: string): string {
  const value = contactDetails[key];
  return typeof value === 'string' ? value : '';
}

export default function SchoolSettingsPanel() {
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [reportCardFooter, setReportCardFooter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      if (!supabase) {
        setError('School database is not configured.');
        setIsLoading(false);
        return;
      }
      try {
        const { data, error: loadError } = await supabase
          .from('school_settings')
          .select('school_name,contact_details,report_card_footer,watermark_object_path,signature_object_path,configuration_version')
          .eq('id', true)
          .single();
        if (cancelled) return;
        if (loadError) {
          setError('School settings could not be loaded. Refresh or contact the system administrator.');
          return;
        }
        const parsed = parseSettings(data);
        if (!parsed) {
          setError('School settings returned an unexpected response.');
          return;
        }
        setSettings(parsed);
        setSchoolName(parsed.school_name);
        setReportCardFooter(parsed.report_card_footer);
      } catch {
        if (!cancelled) setError('School settings could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateContact(key: string, value: string) {
    setSettings((current) => current
      ? { ...current, contact_details: { ...current.contact_details, [key]: value } }
      : current);
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !settings || isSaving || !schoolName.trim()) return;
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const { data, error: saveError } = await supabase.rpc('save_school_settings', {
        p_school_name: schoolName.trim(),
        p_contact_details: settings.contact_details,
        p_report_card_footer: reportCardFooter.trim(),
        p_watermark_object_path: settings.watermark_object_path,
        p_signature_object_path: settings.signature_object_path,
      });
      if (saveError || typeof data !== 'number') {
        setError('School settings could not be saved. Verify the values and try again.');
        return;
      }
      setSettings((current) => current
        ? { ...current, configuration_version: data }
        : current);
      setMessage(`School settings saved as configuration version ${data}.`);
    } catch {
      setError('School settings could not be saved. Check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="family-panel school-settings-panel" aria-labelledby="school-settings-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">School administration</span>
          <h2 id="school-settings-heading">School details</h2>
        </div>
        {settings && <span className="attendance-count">Version {settings.configuration_version}</span>}
      </div>
      {isLoading ? (
        <p className="empty-state">Loading school settings…</p>
      ) : (
        <form className="school-settings-form" onSubmit={(event) => void saveSettings(event)}>
          <label>
            <span className="field-label">School name</span>
            <input
              className="text-field"
              maxLength={200}
              onChange={(event) => setSchoolName(event.target.value)}
              required
              value={schoolName}
            />
          </label>
          <label>
            <span className="field-label">Contact phone</span>
            <input
              autoComplete="tel"
              className="text-field"
              maxLength={100}
              onChange={(event) => updateContact('phone', event.target.value)}
              value={settings ? contactValue(settings.contact_details, 'phone') : ''}
            />
          </label>
          <label>
            <span className="field-label">Contact email</span>
            <input
              autoComplete="email"
              className="text-field"
              maxLength={254}
              onChange={(event) => updateContact('email', event.target.value)}
              type="email"
              value={settings ? contactValue(settings.contact_details, 'email') : ''}
            />
          </label>
          <label>
            <span className="field-label">Address</span>
            <input
              autoComplete="street-address"
              className="text-field"
              maxLength={500}
              onChange={(event) => updateContact('address', event.target.value)}
              value={settings ? contactValue(settings.contact_details, 'address') : ''}
            />
          </label>
          <label className="school-footer-field">
            <span className="field-label">Report card footer</span>
            <textarea
              className="text-field update-textarea"
              maxLength={1000}
              onChange={(event) => setReportCardFooter(event.target.value)}
              value={reportCardFooter}
            />
          </label>
          <button className="sign-in-button" disabled={!settings || isSaving} type="submit">
            <span>{isSaving ? 'Saving settings…' : 'Save school details'}</span>
          </button>
          {error && <p className="form-notice" role="alert">{error}</p>}
          {message && <p className="success-notice" role="status">{message}</p>}
        </form>
      )}
    </section>
  );
}
