import { ArrowDown, ArrowRight, BookOpenCheck, CalendarCheck2, UsersRound } from 'lucide-react';
import schoolLogo from '../assets/wisdom-source-logo.png';

export default function PublicHomePage({ onPortalLogin }: { onPortalLogin: () => void }) {
  return (
    <main className="public-home">
      <header className="public-home-header">
        <a aria-label="Wisdom Source School home" className="public-home-brand" href="#home">
          <img alt="" src={schoolLogo} />
          <span>
            <strong>Wisdom Source School</strong>
            <small>Learning · Growth · Community</small>
          </span>
        </a>
        <nav aria-label="Main navigation" className="public-home-nav">
          <a href="#our-community">Our community</a>
          <a href="#school-life">School life</a>
          <button className="public-home-login" onClick={onPortalLogin} type="button">
            Portal sign in <ArrowRight size={16} aria-hidden="true" />
          </button>
        </nav>
      </header>

      <section aria-labelledby="public-home-heading" className="public-home-hero" id="home">
        <div className="public-home-hero-copy">
          <span className="public-home-eyebrow">Wisdom Source School</span>
          <h1 id="public-home-heading">A place to learn, grow, and belong.</h1>
          <p>
            A welcoming school community where learners are supported and families stay connected
            to the school journey.
          </p>
          <div className="public-home-actions">
            <button className="public-home-primary" onClick={onPortalLogin} type="button">
              Sign in to the school portal <ArrowRight size={17} aria-hidden="true" />
            </button>
            <a className="public-home-secondary" href="#our-community">
              Discover our community <ArrowDown size={16} aria-hidden="true" />
            </a>
          </div>
          <div className="public-home-values" aria-label="School values">
            <span>Learning</span><i aria-hidden="true" />
            <span>Growth</span><i aria-hidden="true" />
            <span>Community</span>
          </div>
        </div>
        <div aria-hidden="true" className="public-home-art">
          <div className="public-home-art-orbit public-home-art-orbit-one" />
          <div className="public-home-art-orbit public-home-art-orbit-two" />
          <div className="public-home-art-sun" />
          <div className="public-home-art-card">
            <img alt="" src={schoolLogo} />
            <span>WISDOM SOURCE</span>
            <strong>Every learner.<br />A bright possibility.</strong>
            <small>Learning · Growth · Community</small>
          </div>
          <span className="public-home-art-spark public-home-art-spark-one">✳</span>
          <span className="public-home-art-spark public-home-art-spark-two">✳</span>
        </div>
        <a aria-label="Scroll to our community" className="public-home-scroll" href="#our-community">
          <ArrowDown size={16} aria-hidden="true" />
        </a>
      </section>

      <section aria-labelledby="community-heading" className="public-home-community" id="our-community">
        <div className="public-home-section-intro">
          <span className="public-home-eyebrow">Welcome to our school</span>
          <h2 id="community-heading">Growing together, every school day.</h2>
          <p>
            School is a shared journey. We bring learners, families, and school staff together
            around the moments that matter.
          </p>
        </div>
        <div className="public-home-feature-grid" id="school-life">
          <article className="public-home-feature">
            <span className="public-home-feature-icon"><BookOpenCheck size={20} aria-hidden="true" /></span>
            <span className="public-home-eyebrow">Learning</span>
            <h3>Progress with purpose</h3>
            <p>Learning updates and published results help families follow each learner’s progress.</p>
          </article>
          <article className="public-home-feature">
            <span className="public-home-feature-icon"><CalendarCheck2 size={20} aria-hidden="true" /></span>
            <span className="public-home-eyebrow">School life</span>
            <h3>Stay in the know</h3>
            <p>Find attendance, timetables, school notices, and calendar updates in one place.</p>
          </article>
          <article className="public-home-feature">
            <span className="public-home-feature-icon"><UsersRound size={20} aria-hidden="true" /></span>
            <span className="public-home-eyebrow">Community</span>
            <h3>Families belong here</h3>
            <p>Parents can access information for the learners linked to their own account.</p>
          </article>
        </div>
      </section>

      <section className="public-home-portal-cta">
        <div>
          <span className="public-home-eyebrow">A connected school community</span>
          <h2>Your school journey, all in one place.</h2>
          <p>Sign in to view the school information available to your account.</p>
        </div>
        <button className="public-home-primary" onClick={onPortalLogin} type="button">
          Go to the school portal <ArrowRight size={17} aria-hidden="true" />
        </button>
      </section>

      <footer className="public-home-footer">
        <a aria-label="Wisdom Source School home" className="public-home-brand" href="#home">
          <img alt="" src={schoolLogo} />
          <span><strong>Wisdom Source School</strong><small>Learning · Growth · Community</small></span>
        </a>
        <span>Wisdom Source School · A community for learning and growth</span>
      </footer>
    </main>
  );
}
