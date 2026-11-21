import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { getNote, listNotesForStudent, saveNote } from "./notes.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesLater(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

describe("saving a Note", () => {
  it("creates a Note on a Lesson with none, with the body trimmed", () => {
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();

    saveNote(db, base.user.id, lessonIds[0], "  # not a heading *really*  ", NOW);

    expect(getNote(db, base.user.id, lessonIds[0])).toEqual({
      body: "# not a heading *really*",
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonIds[0], "First thoughts", NOW);
    const later = minutesLater(30);

    const result = saveNote(db, base.user.id, lessonIds[0], "Second thoughts", later);

    expect(result).toMatchObject({
      ok: true,
      note: {
        body: "Second thoughts",
        createdAt: NOW.toISOString(),
        updatedAt: later.toISOString(),
      },
    });
    expect(listNotesForStudent(db, base.user.id)).toHaveLength(1);
  });

  it("accepts exactly 2,000 characters and refuses 2,001", () => {
    expect(saveNote(db, base.user.id, lessonIds[0], "a".repeat(2000), NOW).ok).toBe(true);

    expect(
      saveNote(db, base.user.id, lessonIds[1], "a".repeat(2001), NOW)
    ).toEqual({ ok: false, error: "A note must be 2,000 characters or fewer." });
    expect(getNote(db, base.user.id, lessonIds[1])).toBeUndefined();
  });

  it("never leaves a Student with two Notes on one Lesson", () => {
    saveNote(db, base.user.id, lessonIds[0], "Mine", NOW);

    expect(() =>
      db
        .insert(schema.notes)
        .values({ userId: base.user.id, lessonId: lessonIds[0], body: "Dup" })
        .run()
    ).toThrow();
  });
});

describe("listing a Student's Notes", () => {
  it("shows only that Student's Notes, most recently edited first, with Lesson and Course", () => {
    saveNote(db, base.user.id, lessonIds[0], "Older", NOW);
    saveNote(db, base.user.id, lessonIds[2], "Newer", minutesLater(5));
    saveNote(db, base.instructor.id, lessonIds[1], "Not yours", minutesLater(10));
    saveNote(db, base.user.id, lessonIds[0], "Older, edited", minutesLater(20));

    expect(listNotesForStudent(db, base.user.id)).toMatchObject([
      {
        body: "Older, edited",
        lessonId: lessonIds[0],
        lessonTitle: "Lesson 1",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
      { body: "Newer", lessonId: lessonIds[2], lessonTitle: "Lesson 3" },
    ]);
  });
});
