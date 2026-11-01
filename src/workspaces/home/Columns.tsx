import { InFlightSection, LandedSection, NeedsYouSection, ProjectsSection, ResumeSection, SectionBoundary } from './sections'

/**
 * Home's two columns (2fr / 1fr, 32px gap; one column below 1024). On phones the order is
 * Needs you, In flight, Landed, Projects, Resume (§6.1).
 */
export default function Columns() {
  return (
    <div className="mt-12 grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-10">
        <SectionBoundary name="Needs you">
          <NeedsYouSection />
        </SectionBoundary>
        <SectionBoundary name="In flight">
          <InFlightSection />
        </SectionBoundary>
        <SectionBoundary name="Landed">
          <LandedSection />
        </SectionBoundary>
      </div>
      <div className="flex min-w-0 flex-col gap-10">
        <SectionBoundary name="Projects">
          <ProjectsSection />
        </SectionBoundary>
        <SectionBoundary name="Resume">
          <ResumeSection />
        </SectionBoundary>
      </div>
    </div>
  )
}
