-- ============================================================
-- Seed: York University Lassonde — General Engineering first year,
-- Civil Engineering (BEng) intended stream.
--
-- Run this ONCE in the Supabase SQL Editor, AFTER schema.sql. It prints
-- the new plan's id at the end — open the planner at
--   /academic-planner/?plan=<that id>
--
-- WHAT IS AND ISN'T VERIFIED
--  - Year 1 (both terms): taken directly from the student's own York
--    timetable screenshots — courses, sections, components, rooms and
--    meeting times. Times were transcribed by eye from a 30-minute grid,
--    so spot-check the odd start/end against the official timetable.
--  - Years 2-4: course lists come from York's 2022-2023 Undergraduate
--    Calendar entry for Civil Engineering. The calendar groups courses by
--    year, and that grouping is preserved here; the split of each year
--    across Fall/Winter is NOT published there and is a balanced guess.
--    Requirements also change between calendar years (e.g. CIVL 4005 was
--    added to the Group A technical electives for FW25/26). Treat years
--    2-4 as a starting scaffold to confirm with Lassonde advising, not
--    as an authoritative degree audit.
--  - Course titles for years 2-4 are intentionally left as bare codes
--    where the calendar listing did not supply a title, rather than
--    inventing one.
-- ============================================================

do $$
declare
  v_plan uuid;
  r_core uuid; r_civ2 uuid; r_civ3 uuid; r_civ4 uuid; r_tech uuid; r_comp uuid;
  c uuid;
begin
  insert into academic_plans(title, major, total_credits_required, terms)
  values (
    'BEng Civil Engineering — York (Lassonde)',
    'Civil Engineering (entering via General Engineering first year)',
    140,
    '["Year 1 – Fall (F)","Year 1 – Winter (W)","Year 2 – Fall","Year 2 – Winter","Year 3 – Fall","Year 3 – Winter","Year 4 – Fall","Year 4 – Winter"]'::jsonb
  ) returning id into v_plan;

  -- ---------- requirement categories ----------
  insert into academic_requirements(plan_id, name, credits_required, sort_order)
    values (v_plan, 'Engineering Program Core', 54, 0) returning id into r_core;
  insert into academic_requirements(plan_id, name, credits_required, sort_order)
    values (v_plan, 'Civil Core – Year 2', 29, 1) returning id into r_civ2;
  insert into academic_requirements(plan_id, name, credits_required, sort_order)
    values (v_plan, 'Civil Core – Year 3', 33, 2) returning id into r_civ3;
  insert into academic_requirements(plan_id, name, credits_required, sort_order)
    values (v_plan, 'Civil Core – Year 4', 12, 3) returning id into r_civ4;
  insert into academic_requirements(plan_id, name, credits_required, sort_order)
    values (v_plan, 'Technical Electives', 12, 4) returning id into r_tech;
  insert into academic_requirements(plan_id, name, credits_required, sort_order)
    values (v_plan, 'Complementary Studies', 12, 5) returning id into r_comp;

  -- =========================================================
  -- YEAR 1 — FALL (term_index 0) — from the real timetable
  -- =========================================================

  -- SC/MATH 1025 3.00 — Lecture MWF 9:30-10:30, Keele LAS C
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, section, sort_order)
    values (v_plan, 0, 'SC/MATH 1025 3.00', 'Applied Linear Algebra', 3, r_core, 'planned', 'Section B', 0)
    returning id into c;
  insert into academic_course_meetings(course_id, component, day_of_week, start_min, end_min, location) values
    (c, 'Lecture', 0, 570, 630, 'Keele: LAS C'),
    (c, 'Lecture', 2, 570, 630, 'Keele: LAS C'),
    (c, 'Lecture', 4, 570, 630, 'Keele: LAS C');

  -- SC/MATH 1013 3.00 — Lecture Tue/Thu 10:00-11:30, Keele LAS C
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, section, sort_order)
    values (v_plan, 0, 'SC/MATH 1013 3.00', 'Applied Calculus I', 3, r_core, 'planned', 'Section B', 1)
    returning id into c;
  insert into academic_course_meetings(course_id, component, day_of_week, start_min, end_min, location) values
    (c, 'Lecture', 1, 600, 690, 'Keele: LAS C'),
    (c, 'Lecture', 3, 600, 690, 'Keele: LAS C');

  -- LE/EECS 1011 3.00 — Blended Mon/Wed 10:30-11:30 LAS B; Lab 04 Wed 14:30-16:00 BC 230
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, section, sort_order)
    values (v_plan, 0, 'LE/EECS 1011 3.00', 'Computational Thinking Through Mechatronics', 3, r_core, 'planned', 'Section F', 2)
    returning id into c;
  insert into academic_course_meetings(course_id, component, day_of_week, start_min, end_min, location) values
    (c, 'Blended Online and Classroom', 0, 630, 690, 'Keele: LAS B'),
    (c, 'Blended Online and Classroom', 2, 630, 690, 'Keele: LAS B'),
    (c, 'Laboratory', 2, 870, 960, 'Keele: BC 230 (Lab 04)');

  -- SC/PHYS 1800 3.00 — Lecture MWF 11:30-12:30 CLH I; Tutorial 01 Fri 10:30-11:30 CLH I; Lab 10 Thu 16:00-18:00 BC 102F
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, section, sort_order)
    values (v_plan, 0, 'SC/PHYS 1800 3.00', 'Engineering Mechanics', 3, r_core, 'planned', 'Section A', 3)
    returning id into c;
  insert into academic_course_meetings(course_id, component, day_of_week, start_min, end_min, location) values
    (c, 'Lecture', 0, 690, 750, 'Keele: CLH I'),
    (c, 'Lecture', 2, 690, 750, 'Keele: CLH I'),
    (c, 'Lecture', 4, 690, 750, 'Keele: CLH I'),
    (c, 'Tutorial', 4, 630, 690, 'Keele: CLH I (Tut 01)'),
    (c, 'Laboratory', 3, 960, 1080, 'Keele: BC 102F (Lab 10)');

  -- LE/ENG 1101 4.00 — Tutorial 02 Tue 13:00-14:00 BRG 313; Blended Thu 13:00-14:00
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, section, sort_order)
    values (v_plan, 0, 'LE/ENG 1101 4.00', 'Introduction to Engineering & Design I', 4, r_core, 'planned', 'Section B', 4)
    returning id into c;
  insert into academic_course_meetings(course_id, component, day_of_week, start_min, end_min, location) values
    (c, 'Tutorial', 1, 780, 840, 'Keele: BRG 313 (Tut 02)'),
    (c, 'Blended Online and Classroom', 3, 780, 840, '');

  -- =========================================================
  -- YEAR 1 — WINTER (term_index 1) — from the real timetable
  -- =========================================================

  -- SC/MATH 1014 3.00 — Lecture MWF 8:30-9:30, Keele VH A
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, section, sort_order)
    values (v_plan, 1, 'SC/MATH 1014 3.00', 'Applied Calculus II', 3, r_core, 'planned', 'Section O', 0)
    returning id into c;
  insert into academic_course_meetings(course_id, component, day_of_week, start_min, end_min, location) values
    (c, 'Lecture', 0, 510, 570, 'Keele: VH A'),
    (c, 'Lecture', 2, 510, 570, 'Keele: VH A'),
    (c, 'Lecture', 4, 510, 570, 'Keele: VH A');

  -- SC/PHYS 1801 3.00 — Lecture MWF 9:30-10:30 VH A; Tutorial 01 Fri 10:30-11:30 VH A; Lab 10 Thu 16:00-18:00 BC 102F
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, section, sort_order)
    values (v_plan, 1, 'SC/PHYS 1801 3.00', 'Electricity & Magnetism for Engineers', 3, r_core, 'planned', 'Section M', 1)
    returning id into c;
  insert into academic_course_meetings(course_id, component, day_of_week, start_min, end_min, location) values
    (c, 'Lecture', 0, 570, 630, 'Keele: VH A'),
    (c, 'Lecture', 2, 570, 630, 'Keele: VH A'),
    (c, 'Lecture', 4, 570, 630, 'Keele: VH A'),
    (c, 'Tutorial', 4, 630, 690, 'Keele: VH A (Tut 01)'),
    (c, 'Laboratory', 3, 960, 1080, 'Keele: BC 102F (Lab 10)');

  -- SC/CHEM 1100 4.00 — Lecture Tue/Thu 8:30-10:00 LAS A; Tutorial 01 Fri 12:30-13:30 CLH I; Lab 05 Tue 14:30-16:00 CB 217B
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, section, sort_order)
    values (v_plan, 1, 'SC/CHEM 1100 4.00', 'Chemistry for Engineers', 4, r_core, 'planned', 'Section M', 2)
    returning id into c;
  insert into academic_course_meetings(course_id, component, day_of_week, start_min, end_min, location) values
    (c, 'Lecture', 1, 510, 600, 'Keele: LAS A'),
    (c, 'Lecture', 3, 510, 600, 'Keele: LAS A'),
    (c, 'Tutorial', 4, 750, 810, 'Keele: CLH I (Tut 01)'),
    (c, 'Laboratory', 1, 870, 960, 'Keele: CB 217B (Lab 05)');

  -- LE/ENG 1102 4.00 — Tutorial 02 Tue 10:30-12:00 SLH 107; Blended Thu 11:30-13:00
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, section, sort_order)
    values (v_plan, 1, 'LE/ENG 1102 4.00', 'Introduction to Engineering & Design II', 4, r_core, 'planned', 'Section Q', 3)
    returning id into c;
  insert into academic_course_meetings(course_id, component, day_of_week, start_min, end_min, location) values
    (c, 'Tutorial', 1, 630, 720, 'Keele: SLH 107 (Tut 02)'),
    (c, 'Blended Online and Classroom', 3, 690, 780, '');

  -- LE/EECS 1021 3.00 — Lab 04 Wed 12:30-14:30 CC 109; Blended Fri 13:30-15:00 CLH E
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, section, sort_order)
    values (v_plan, 1, 'LE/EECS 1021 3.00', 'Object Oriented Programming from Sensors to Actuators', 3, r_core, 'planned', 'Section X', 4)
    returning id into c;
  insert into academic_course_meetings(course_id, component, day_of_week, start_min, end_min, location) values
    (c, 'Laboratory', 2, 750, 870, 'Keele: CC 109 (Lab 04)'),
    (c, 'Blended Online and Classroom', 4, 810, 900, 'Keele: CLH E');

  -- LE/ESSE 1012 3.00 — Lab 08 Mon 12:30-14:30 PSE 020A; Lecture Mon/Wed 16:00-17:30 ACW 109
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, section, sort_order)
    values (v_plan, 1, 'LE/ESSE 1012 3.00', 'Engineering Graphics & Geomatics', 3, r_core, 'planned', 'Section M', 5)
    returning id into c;
  insert into academic_course_meetings(course_id, component, day_of_week, start_min, end_min, location) values
    (c, 'Laboratory', 0, 750, 870, 'Keele: PSE 020A (Lab 08)'),
    (c, 'Lecture', 0, 960, 1050, 'Keele: ACW 109'),
    (c, 'Lecture', 2, 960, 1050, 'Keele: ACW 109');

  -- =========================================================
  -- YEARS 2-4 — scaffold from the 2022-23 calendar (VERIFY)
  -- No meeting times: those only exist once you enrol.
  -- =========================================================

  -- Year 2 Fall
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, sort_order) values
    (v_plan, 2, 'SC/MATH 2015 3.00', 'Applied Multivariate & Vector Calculus', 3, r_core, 'planned', 0),
    (v_plan, 2, 'SC/MATH 2271 3.00', 'Differential Equations for Engineers',    3, r_civ2, 'planned', 1),
    (v_plan, 2, 'LE/ENG 2001 3.00',  'LE/ENG 2001',                             3, r_core, 'planned', 2),
    (v_plan, 2, 'LE/CIVL 2000 3.00', 'LE/CIVL 2000',                            3, r_civ2, 'planned', 3),
    (v_plan, 2, 'LE/CIVL 2210 4.00', 'LE/CIVL 2210',                            4, r_civ2, 'planned', 4),
    (v_plan, 2, 'Complementary Studies I',  'Humanities / social science elective', 3, r_comp, 'planned', 5);

  -- Year 2 Winter
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, sort_order) values
    (v_plan, 3, 'SC/MATH 2930 3.00', 'Applied Statistics for Engineers', 3, r_core, 'planned', 0),
    (v_plan, 3, 'LE/ENG 2003 3.00',  'LE/ENG 2003',                      3, r_core, 'planned', 1),
    (v_plan, 3, 'LE/CIVL 2220 4.00', 'LE/CIVL 2220',                     4, r_civ2, 'planned', 2),
    (v_plan, 3, 'LE/CIVL 2120 3.00', 'LE/CIVL 2120',                     3, r_civ2, 'planned', 3),
    (v_plan, 3, 'LE/CIVL 2150 3.00', 'LE/CIVL 2150',                     3, r_civ2, 'planned', 4),
    (v_plan, 3, 'LE/ESSE 2635 3.00', 'LE/ESSE 2635',                     3, r_civ2, 'planned', 5);

  -- Year 3 Fall (carries the remaining year-2-listed courses)
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, notes, sort_order) values
    (v_plan, 4, 'LE/CIVL 2160 3.00', 'LE/CIVL 2160', 3, r_civ2, 'planned', 'Calendar lists this as a year-2 course', 0),
    (v_plan, 4, 'LE/CIVL 2240 3.00', 'LE/CIVL 2240', 3, r_civ2, 'planned', 'Calendar lists this as a year-2 course', 1),
    (v_plan, 4, 'EU/ENVS 2150 3.00', 'EU/ENVS 2150 — or LE/ESSE 2210 3.00', 3, r_core, 'planned', 'Either/or requirement', 2),
    (v_plan, 4, 'LE/CIVL 3110 3.00', 'LE/CIVL 3110', 3, r_civ3, 'planned', '', 3),
    (v_plan, 4, 'LE/CIVL 3120 4.00', 'LE/CIVL 3120', 4, r_civ3, 'planned', '', 4),
    (v_plan, 4, 'LE/CIVL 3140 3.00', 'LE/CIVL 3140', 3, r_civ3, 'planned', '', 5);

  -- Year 3 Winter
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, sort_order) values
    (v_plan, 5, 'LE/ENG 3000 3.00',  'LE/ENG 3000',  3, r_core, 'planned', 0),
    (v_plan, 5, 'LE/CIVL 3130 4.00', 'LE/CIVL 3130', 4, r_civ3, 'planned', 1),
    (v_plan, 5, 'LE/CIVL 3160 3.00', 'LE/CIVL 3160', 3, r_civ3, 'planned', 2),
    (v_plan, 5, 'LE/CIVL 3210 3.00', 'LE/CIVL 3210', 3, r_civ3, 'planned', 3),
    (v_plan, 5, 'LE/CIVL 3220 3.00', 'LE/CIVL 3220', 3, r_civ3, 'planned', 4),
    (v_plan, 5, 'Complementary Studies II', 'Humanities / social science elective', 3, r_comp, 'planned', 5);

  -- Year 4 Fall (carries the remaining year-3-listed courses + capstone)
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, notes, sort_order) values
    (v_plan, 6, 'LE/CIVL 3230 4.00', 'LE/CIVL 3230', 4, r_civ3, 'planned', 'Calendar lists this as a year-3 course', 0),
    (v_plan, 6, 'LE/CIVL 3240 3.00', 'LE/CIVL 3240', 3, r_civ3, 'planned', 'Calendar lists this as a year-3 course', 1),
    (v_plan, 6, 'LE/CIVL 3260 3.00', 'LE/CIVL 3260', 3, r_civ3, 'planned', 'Calendar lists this as a year-3 course', 2),
    (v_plan, 6, 'LE/CIVL 4000 6.00', 'Capstone Design Project', 6, r_civ4, 'planned', 'Usually runs across both terms', 3),
    (v_plan, 6, 'LE/CIVL 4110 3.00', 'LE/CIVL 4110', 3, r_civ4, 'planned', '', 4);

  -- Year 4 Winter — technical electives: 4 courses, max 3 from any one group
  insert into academic_courses(plan_id, term_index, code, title, credits, requirement_id, status, notes, sort_order) values
    (v_plan, 7, 'LE/CIVL 4210 3.00', 'LE/CIVL 4210', 3, r_civ4, 'planned', '', 0),
    (v_plan, 7, 'Technical Elective 1', 'Group A Structures / B Geotech / C Hydro / D Transport / E Environmental', 3, r_tech, 'planned', 'Max 3 of your 4 from any one group', 1),
    (v_plan, 7, 'Technical Elective 2', 'Group A Structures / B Geotech / C Hydro / D Transport / E Environmental', 3, r_tech, 'planned', 'Max 3 of your 4 from any one group', 2),
    (v_plan, 7, 'Technical Elective 3', 'Group A Structures / B Geotech / C Hydro / D Transport / E Environmental', 3, r_tech, 'planned', 'Max 3 of your 4 from any one group', 3),
    (v_plan, 7, 'Technical Elective 4', 'Group A Structures / B Geotech / C Hydro / D Transport / E Environmental', 3, r_tech, 'planned', 'Max 3 of your 4 from any one group', 4),
    (v_plan, 7, 'Complementary Studies III', 'Humanities / social science elective', 3, r_comp, 'planned', '', 5),
    (v_plan, 7, 'Complementary Studies IV',  'Humanities / social science elective', 3, r_comp, 'planned', '', 6);

  raise notice 'Academic plan created: %', v_plan;
end $$;

-- the id to open the planner with
select id as plan_id,
       title,
       '/academic-planner/?plan=' || id as open_at
from academic_plans
order by created_at desc
limit 1;
