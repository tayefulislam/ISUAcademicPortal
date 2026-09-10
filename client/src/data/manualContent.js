// Central content source for the in-app User Manual (client/src/pages/Manual.jsx).
// One entry per role — student/faculty/admin/super_admin — each an ordered
// list of { title, items[] } topics rendered as an accordion. Keep entries
// short and task-oriented (how do I do X), not a feature-by-feature dump.

export const MANUALS = {
  student: {
    heading: 'Student Manual',
    intro: 'Everything you need to find materials, submit work, take exams, and stay on top of your courses.',
    topics: [
      {
        title: 'Finding course materials',
        items: [
          'Use "Browse & Search" in the top menu, or the search box on the Home page, to find files by course, department, batch, or keyword.',
          'The search is typo-tolerant — a misspelled or partial word (e.g. "qution" or "photo") still finds the right result.',
          'Click any file to view details, then "View" or "Download". Files marked "login required" only show up once you\'re signed in.',
          'Use the star/bookmark icon on a file to save it — find all your saved files under Profile → Bookmarks.',
        ],
      },
      {
        title: 'My Courses',
        items: [
          'My Courses shows every course you have access to — your own department\'s courses, plus any course you\'re separately enrolled in (retake, backlog, extra, improvement, or advance).',
          'To request access to an extra course, use the "Request Enrollment" option on My Courses (if enabled) — a Faculty member will approve or reject it, and you\'ll get a notification either way.',
        ],
      },
      {
        title: 'Submitting your own material',
        items: [
          'From your Dashboard, use "Submit Material" to upload a file you want to share.',
          'Submissions start as "pending" and are not visible to anyone else until a Faculty/Admin reviewer approves them.',
        ],
      },
      {
        title: 'Assignments',
        items: [
          'Open "Assignments" to see every assignment targeted at your department/course/batch/semester.',
          'Submit a file and/or text answer before the deadline shown on each assignment. A late submission is still accepted (marked "late") unless the assignment has been closed.',
          'Once your Faculty grades it, your marks and feedback appear on the same page, and you get an "Assignment Result Published" notification.',
        ],
      },
      {
        title: 'Quizzes & Exams',
        items: [
          'Open "Quizzes" to see every exam you\'re eligible for. Starting an attempt begins the timer immediately — don\'t start until you\'re ready.',
          'Answers autosave as you go; if your time runs out, the attempt is automatically submitted with whatever you\'d answered.',
          'If the exam allows it, your result appears immediately after submitting; otherwise it appears once your Faculty finishes grading (for exams with written/long-answer questions).',
          'You only ever see your own results — never another student\'s.',
        ],
      },
      {
        title: 'Notices',
        items: [
          'The Notices page shows announcements relevant to you — from your department, your courses, your batch, or your semester, plus anything marked "everyone".',
        ],
      },
      {
        title: 'Messages',
        items: [
          'If messaging is enabled, you can message any Faculty member who teaches your department or one of your courses.',
          'Start a new conversation from Messages → search by name, or continue an existing conversation from your inbox.',
        ],
      },
      {
        title: 'Notifications',
        items: [
          'The bell icon (top right) shows your unread notifications — new materials, assignment/exam results, notices, and messages.',
          'Click "Enable Notifications" when prompted to also get these as push notifications on your device, even when the app is closed.',
          'On iPhone/iPad, you must first add this app to your Home Screen (Share → Add to Home Screen) before push notifications can be enabled — this is an Apple restriction, not something the app can skip.',
          'Go to Notifications → Settings to turn specific notification types on/off, or to turn push/email delivery on/off entirely.',
        ],
      },
      {
        title: 'Your profile',
        items: [
          'Profile lets you update your name and password, and (if your institution requires it) upload your Student ID photo for approval.',
        ],
      },
    ],
  },

  faculty: {
    heading: 'Faculty Manual',
    intro: 'How to upload materials, manage assignments and exams, grade student work, and communicate with students.',
    topics: [
      {
        title: 'Uploading course materials',
        items: [
          '"Upload Material" lets you attach one or more files under a Department, Course, Category, and (optionally) Chapter/Topic.',
          'Restrict a file to specific batches, semesters, or courses if it shouldn\'t be visible to everyone in that course.',
          'Every enrolled/eligible student is automatically notified in-app (and by push, if enabled) the moment you upload — you never need to notify them manually.',
          'To replace an outdated file with a new version (keeping the old one in history), use the file\'s "Replace" option — students are notified again that it was updated.',
        ],
      },
      {
        title: 'Reviewing student submissions',
        items: [
          '"Review Submissions" lists materials students have submitted for your review — approve to publish them, or reject with a reason.',
        ],
      },
      {
        title: 'Notices',
        items: [
          'Create a notice targeted at your assigned department(s)/course(s) — students in any of those groups receive it.',
          'You cannot target "everyone" — that\'s reserved for Admin/Super Admin, keeping your notices scoped to your own students.',
        ],
      },
      {
        title: 'Assignments',
        items: [
          'Create an assignment with a title, description, deadline, max marks, and a submission type (file, text, or both).',
          'Target it at your department(s)/course(s)/batch(es)/semester(s) — only students matching every non-empty axis you set will see it.',
          'Publishing an assignment (not saving as draft) immediately notifies every targeted student.',
          '"Submissions" (under the assignment) lists what each student has turned in. Enter marks and feedback per student to grade — the student is notified the moment you save a grade.',
        ],
      },
      {
        title: 'Question Bank',
        items: [
          'Add reusable questions (MCQ, true/false, numerical, matching, long-answer) tagged with difficulty and topic/tags.',
          'The search box in Question Bank is typo-tolerant — you can find a question even with a partial or misspelled search term.',
        ],
      },
      {
        title: 'Quizzes & Exams',
        items: [
          'Build a quiz from fixed, hand-picked questions, or switch to "Random Selection" to have the system pick N questions per rule (by course/difficulty/tags) fresh for each student — the app checks enough questions exist before you can save.',
          'Configure timing, attempts allowed, randomized question/option order, and negative marking.',
          'Publishing a quiz notifies every eligible student immediately.',
          'Grade any long-answer questions from the attempt\'s grading screen — once every question on an attempt is graded, the student is notified their result is ready.',
        ],
      },
      {
        title: 'Messages',
        items: [
          'Message any student in your assigned department(s)/course(s) directly. They\'re notified the moment you send a message.',
        ],
      },
      {
        title: 'Email Center',
        items: [
          'Send a broadcast email to your own students (by department/course/batch/semester, or individually) if the email system is enabled.',
        ],
      },
      {
        title: 'Course Enrollment',
        items: [
          'Approve or reject student requests to enroll in an additional course (retake, backlog, extra, improvement, advance) for a course you\'re assigned to.',
          'Approving or rejecting a request notifies the student automatically.',
        ],
      },
      {
        title: 'Notifications',
        items: [
          'You get the same notification bell, push notifications, and per-type settings as students — including new enrollment requests from students in your scope.',
        ],
      },
    ],
  },

  admin: {
    heading: 'Admin Manual',
    intro: 'Admin has the same modules as Faculty, plus institution-wide oversight — which of these you can see depends on the permissions Super Admin has granted your role.',
    topics: [
      {
        title: 'What "Admin" can mean here',
        items: [
          'The base "Admin" role has every module below by default. Super Admin can also create further roles (e.g. "CR") with only a subset of these modules — if something described here isn\'t in your sidebar, you haven\'t been granted that permission.',
        ],
      },
      {
        title: 'Files',
        items: [
          'My Files / Upload File work exactly like Faculty\'s — the difference is you can typically upload for any department/course, not just your assigned ones.',
        ],
      },
      {
        title: 'Student Approvals',
        items: [
          'If Student ID approval is enabled, review each pending student\'s uploaded ID photo and approve or reject it — a rejected/pending student can still log in but is blocked from restricted materials until approved.',
        ],
      },
      {
        title: 'Material Submissions',
        items: ['Review student-submitted materials institution-wide (not just your own scope), same workflow as Faculty\'s Review Submissions.'],
      },
      {
        title: 'Notices, Assignments, Question Bank, Quizzes',
        items: [
          'Work exactly as described in the Faculty manual, except you can target "everyone" for a notice, and target any department/course rather than only ones assigned to you.',
        ],
      },
      {
        title: 'Messages & Email Center',
        items: ['You can message or email any student or faculty member, not just those in an assigned scope.'],
      },
      {
        title: 'Course Enrollment',
        items: ['Manage enrollment requests/records across every course, not just an assigned subset.'],
      },
    ],
  },

  super_admin: {
    heading: 'Super Admin Manual',
    intro: 'Full institutional control: users, roles/permissions, system configuration, and everything Admin can do.',
    topics: [
      {
        title: 'User Management',
        items: [
          '"All Users" lets you search, filter, block/unblock, change role, and edit any user\'s profile.',
          '"Faculty" is a focused view for creating and managing Faculty accounts and their assigned departments/courses.',
        ],
      },
      {
        title: 'Roles & Permissions',
        items: [
          'Create additional admin-tier roles (e.g. "CR") and choose exactly which modules (Files, Notices, Assignments, Question Bank, Quizzes, Messages, Emails, Enrollments, Notifications, etc.) that role can access.',
          'The built-in "Admin" role has every permission and can\'t be deleted, but its permissions can still be edited.',
        ],
      },
      {
        title: 'System Management',
        items: [
          'Toggle entire subsystems on/off institution-wide: messaging, email, student uploads, student ID approval, course enrollment, quizzes/exams, and more.',
          'Manage Departments, Courses, Batches, Semesters, and Categories that every other part of the app (files, targeting, enrollment) is built on.',
        ],
      },
      {
        title: 'Notifications (Admin)',
        items: [
          'View delivery stats (total/read/unread, broken down by type) across the whole institution.',
          'Send an ad-hoc notification to a specific user, an entire course, an entire department, or everyone — useful for maintenance windows or urgent announcements.',
          'Browse recent notification logs to confirm delivery or spot problems.',
        ],
      },
      {
        title: 'Feedback',
        items: ['Review feedback submitted through the public Feedback form.'],
      },
      {
        title: 'Everything else',
        items: [
          'Files, Notices, Assignments, Question Bank, Quizzes, Messages, Email Center, and Course Enrollment all work exactly as described in the Admin manual — Super Admin has unrestricted access to every one of them plus Administrator-tier accounts.',
        ],
      },
    ],
  },
};
