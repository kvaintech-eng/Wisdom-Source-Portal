import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type CalendarKind = 'event' | 'holiday' | 'closure' | 'break';

export default function SchoolUpdatesPanel({
  sessionId,
  termId,
  termStartsOn,
  termEndsOn,
}: {
  sessionId: string;
  termId: string;
  termStartsOn: string;
  termEndsOn: string;
}) {
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventStartsOn, setEventStartsOn] = useState(termStartsOn);
  const [eventEndsOn, setEventEndsOn] = useState(termStartsOn);
  const [eventKind, setEventKind] = useState<CalendarKind>('event');
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setEventStartsOn(termStartsOn);
    setEventEndsOn(termStartsOn);
    setError('');
    setMessage('');
  }, [sessionId, termId, termStartsOn]);

  async function publishAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || savingAnnouncement || !announcementTitle.trim() || !announcementBody.trim()) return;
    setSavingAnnouncement(true);
    setError('');
    setMessage('');
    try {
      const { error: publishError } = await supabase.rpc('publish_announcement', {
        p_title: announcementTitle.trim(),
        p_body: announcementBody.trim(),
      });
      if (publishError) {
        setError('The announcement could not be published. Check the details and try again.');
        return;
      }
      setAnnouncementTitle('');
      setAnnouncementBody('');
      setMessage('Announcement published and visible to active portal accounts.');
    } catch {
      setError('The announcement could not be published. Check your connection and try again.');
    } finally {
      setSavingAnnouncement(false);
    }
  }

  async function saveCalendarEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || savingEvent || !eventTitle.trim() || !sessionId || !termId) return;
    if (eventStartsOn < termStartsOn || eventEndsOn > termEndsOn || eventStartsOn > eventEndsOn) {
      setError('Calendar dates must fall within the selected term, and the end date cannot precede the start date.');
      return;
    }
    setSavingEvent(true);
    setError('');
    setMessage('');
    try {
      const { error: saveError } = await supabase.rpc('save_calendar_event', {
        p_session_id: sessionId,
        p_term_id: termId,
        p_title: eventTitle.trim(),
        p_description: eventDescription.trim(),
        p_starts_on: eventStartsOn,
        p_ends_on: eventEndsOn,
        p_kind: eventKind,
        p_school_open: eventKind === 'event' && schoolOpen,
      });
      if (saveError) {
        setError('The calendar item could not be saved. Verify its dates and try again.');
        return;
      }
      setEventTitle('');
      setEventDescription('');
      setEventStartsOn(termStartsOn);
      setEventEndsOn(termStartsOn);
      setEventKind('event');
      setSchoolOpen(false);
      setMessage('Calendar item saved and visible in the family portal.');
    } catch {
      setError('The calendar item could not be saved. Check your connection and try again.');
    } finally {
      setSavingEvent(false);
    }
  }

  return (
    <section className="family-panel school-updates-panel" aria-labelledby="school-updates-heading">
      <div className="family-panel-heading">
        <div>
          <span className="eyebrow">School communications</span>
          <h2 id="school-updates-heading">Calendar and announcements</h2>
        </div>
      </div>
      <div className="updates-forms">
        <form className="update-form" onSubmit={(event) => void publishAnnouncement(event)}>
          <h3>Publish an announcement</h3>
          <label>
            <span className="field-label">Title</span>
            <input
              className="text-field"
              maxLength={200}
              onChange={(event) => setAnnouncementTitle(event.target.value)}
              required
              value={announcementTitle}
            />
          </label>
          <label>
            <span className="field-label">Message</span>
            <textarea
              className="text-field update-textarea"
              maxLength={5000}
              onChange={(event) => setAnnouncementBody(event.target.value)}
              required
              value={announcementBody}
            />
          </label>
          <button className="sign-in-button" disabled={savingAnnouncement} type="submit">
            <span>{savingAnnouncement ? 'Publishing…' : 'Publish announcement'}</span>
          </button>
        </form>
        <form className="update-form" onSubmit={(event) => void saveCalendarEvent(event)}>
          <h3>Add a calendar item</h3>
          <label>
            <span className="field-label">Title</span>
            <input
              className="text-field"
              maxLength={200}
              onChange={(event) => setEventTitle(event.target.value)}
              required
              value={eventTitle}
            />
          </label>
          <label>
            <span className="field-label">Description (optional)</span>
            <textarea
              className="text-field update-textarea"
              maxLength={2000}
              onChange={(event) => setEventDescription(event.target.value)}
              value={eventDescription}
            />
          </label>
          <div className="update-date-fields">
            <label>
              <span className="field-label">Starts on</span>
              <input
                className="text-field"
                max={termEndsOn}
                min={termStartsOn}
                onChange={(event) => setEventStartsOn(event.target.value)}
                required
                type="date"
                value={eventStartsOn}
              />
            </label>
            <label>
              <span className="field-label">Ends on</span>
              <input
                className="text-field"
                max={termEndsOn}
                min={termStartsOn}
                onChange={(event) => setEventEndsOn(event.target.value)}
                required
                type="date"
                value={eventEndsOn}
              />
            </label>
          </div>
          <label>
            <span className="field-label">Calendar type</span>
            <select
              className="text-field"
              onChange={(event) => {
                if (event.target.value === 'event'
                  || event.target.value === 'holiday'
                  || event.target.value === 'closure'
                  || event.target.value === 'break') {
                  setEventKind(event.target.value);
                }
              }}
              value={eventKind}
            >
              <option value="event">School event</option>
              <option value="holiday">Public holiday</option>
              <option value="closure">School closure</option>
              <option value="break">School break</option>
            </select>
          </label>
          {eventKind === 'event' && (
            <label className="confirmation-option">
              <input
                checked={schoolOpen}
                onChange={(event) => setSchoolOpen(event.target.checked)}
                type="checkbox"
              />
              <span>School will remain open during this event.</span>
            </label>
          )}
          <button className="sign-in-button" disabled={savingEvent} type="submit">
            <span>{savingEvent ? 'Saving calendar item…' : 'Save calendar item'}</span>
          </button>
        </form>
      </div>
      {error && <p className="form-notice" role="alert">{error}</p>}
      {message && <p className="success-notice" role="status">{message}</p>}
    </section>
  );
}
