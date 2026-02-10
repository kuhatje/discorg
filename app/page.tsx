import DiscordRunner from "@/app/components/DiscordRunner";

export default function HomePage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <header className="siteHeader">
        <div className="siteHeaderInner">
          <div className="brand">discorg</div>
          <nav className="siteNav">
            <a href="#tickets">tickets</a>
            <span className="siteNavSep">/</span>
            <a href="#graph">graph</a>
            <span className="siteNavSep">/</span>
            <a href="#prompt">prompt</a>
          </nav>
        </div>
      </header>

      <main className="grid" style={{ gap: 20 }}>
        <DiscordRunner />
      </main>
    </div>
  );
}
