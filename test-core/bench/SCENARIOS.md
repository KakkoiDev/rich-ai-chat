# Benchmark runner scenarios

Each scenario runs a fresh consumer program in a temporary folder (`tests/js/bench.test.js`).

## Scenarios

### Scenario: a streak run passes every round and the regression round
Given a plan of three rounds plus one regression round for two subjects whose tasks all pass
When the runner finishes
Then the state is stable-and-regression-passed, every task has its checkpoint and duration, and the summed checks are complete

### Scenario: a failed round stops the run and keeps its reports
Given a streak plan whose second round has one failing task
When the runner finishes
Then the state is needs-investigation, the failing report with its detail is kept, no later round ran and the exit code is 1

### Scenario: with rounds in order, no task of a later round starts before the earlier round finished
Given a streak plan of two subjects whose first round has one failing task, run with a concurrency of four
When it runs once freely and once with rounds in order
Then the free run also started the second round's tasks, and the ordered run started only the first round's

### Scenario: only one runner works in a report folder and a stale lock is reclaimed
Given a report folder locked by a running process
When a second runner starts there, and later a runner starts after the locking process has exited
Then the second runner refuses with the locking PID, and the later runner reclaims the stale lock and finishes

### Scenario: a lock or running state left by a process whose PID was reused is stale
Given a run lock and a running state that name a live PID with a start time that PID does not have
When a runner starts in that folder and the state is read
Then the runner reclaims the lock and finishes, the state reads as stale, and the same files with the true start time still count as active

### Scenario: a stale lock replaced by another runner before it is removed is kept
Given a report folder whose lock names a process that is gone, and another runner that replaces that lock with its own while the stale lock is checked
When a runner starts in that folder
Then the runner refuses with the other runner's PID, runs no task and leaves the other runner's lock in place

### Scenario: a runner that is still taking the lock keeps it from a runner starting at the same moment
Given a runner that is held while it reads its own start time, before it creates the lock
When a second runner starts in that folder and takes the lock, and the first runner then goes on
Then the first runner refuses with the second runner's PID and runs no task

### Scenario: a run started under another locale and time zone is still seen as running
Given a run in progress that was started under one time zone and the C locale
When a second runner starts in that folder and the state is read, both under another time zone and the Japanese locale
Then the second runner refuses with the running PID and runs no task, and the state reads as running

### Scenario: an interrupted run resumes from its checkpoints without repeating finished tasks
Given a run interrupted by SIGINT while a task is in progress
When the run is resumed in the same folder
Then the state was interrupted with exit code 130, and the resumed run executes only the unfinished tasks and finishes

### Scenario: a resume refuses when a frozen file changed
Given an interrupted run whose manifest froze a source file
When that file is edited and the run is resumed
Then the runner refuses, naming the changed file, and runs no task

### Scenario: a resume refuses when the list of frozen files changed
Given an interrupted run whose manifest froze one source file
When the run is resumed with a second file added to the frozen list
Then the runner refuses, naming the added file, and runs no task

### Scenario: a resume refuses when the host config changed
Given an interrupted run started with one host config
When the run is resumed with a different config
Then the runner refuses and runs no task

### Scenario: a finished report folder is never reused
Given a folder holding a finished run
When a new run or a resume targets that folder
Then the runner refuses and the finished reports are unchanged

### Scenario: a secret written into a report fails the run
Given a plan whose task writes a configured secret value into its report
When the runner finishes
Then the state is secret-leak, the scan names the file but not the value, and the exit code is 2

### Scenario: a secret written in an encoded form fails the run and a secret too short to scan is reported
Given a plan whose task writes a configured secret JSON-escaped, URL-encoded, base64-encoded and at the end of a large binary file, and a second secret of five characters
When the runner finishes
Then the state is secret-leak, each file is named with the form found but not the value, and the short secret is listed as not scanned

### Scenario: a win-rate run reports its score with a confidence interval
Given a match plan of independent games with wins, losses and draws, and a threshold of 0.51
When the runner finishes
Then the summary has the score and its Wilson interval, and the state is above-threshold only when the lower bound clears the threshold

### Scenario: a task that runs past its time limit is recorded as a timeout and the run goes on
Given a plan of three tasks with a time limit, where the second task never finishes on its own
When the runner finishes
Then the second task's checkpoint says ok false with error timeout, the other tasks ran, and the state is needs-investigation

### Scenario: an infrastructure failure is retried a bounded number of times before it counts
Given a plan with one retry allowed, a task whose first attempt reports an infrastructure failure and a task whose every attempt does
When the runner finishes
Then the first task passes on its second attempt, the second is recorded as failed after two attempts, and the state is needs-investigation

### Scenario: a run stops before a task that would pass the spending cap and resumes under a higher cap
Given a plan of four tasks that each cost one dollar, estimated at one dollar, and a cap of 2.5 dollars
When the runner finishes, and the run is resumed with a cap of 10 dollars
Then two tasks ran, the state is budget-reached with the spend recorded, and the resume runs only the other two and completes

### Scenario: an infrastructure retry never passes the spending cap
Given a plan of three tasks that each cost one dollar per attempt, estimated at one dollar, a cap of 2.5 dollars and two retries allowed, and a first task whose every attempt reports an infrastructure failure
When the runner finishes
Then the first task ran twice and is recorded as failed with its two dollars, no other task ran, and the state is budget-reached

### Scenario: a run that reached its spending cap can still be interrupted while a task is in flight
Given a run that reached its spending cap while one task is still in flight
When the run gets SIGINT
Then the state is interrupted with exit code 130 and no other task started

### Scenario: parallel tasks respect the limit and exclusive groups
Given a plan of six tasks, a concurrency of three and two tasks sharing one exclusive group
When the runner finishes
Then no more than three tasks ran at once, the two grouped tasks never overlapped and all checkpoints were written

### Scenario: seeded prompts vary between keys and repeat for the same key
Given a prompt builder that picks words with a seeded generator
When it builds prompts for twenty rounds and two subjects, then again for the same keys
Then the prompts differ across keys, the same key gives the same prompt, and picked words never repeat within one prompt

### Scenario: a report summarises each subject's cases, timings and failures
Given a finished streak whose tasks report their cases, one of them failing with a detail
When the report command reads the run folder
Then it prints the state, the checks, each subject's passed cases and median and slowest time, and the failing case with its detail, and the JSON form holds the same

### Scenario: with --json a failed command prints its error with a stable code
Given a missing run folder, a command without its folder, an unknown command and a freeze into an existing folder
When each runs with --json, and the missing folder is reported again without it
Then each prints ok false with the code not-found, usage, usage and failed, and without --json the error goes to stderr as text

### Scenario: freezing copies one committed revision and refuses to overwrite
Given a git repository with a committed revision, an uncommitted edit and a dependency folder
When the revision is frozen into a new folder, and again into the same folder
Then the folder holds the committed files without the edit, a copy of the dependencies and a FROZEN.json naming the revision, and the second freeze is refused

### Scenario: a detached run outlives its launcher and is watched to the end
Given a frozen consumer whose benchmark takes a few tasks
When a short-lived launcher starts it detached and exits, and the watch command waits on its folder
Then the run finishes on its own, the watch command reports its final state and exits with the run's exit code, and its output went to the log files

### Scenario: a detached run can be stopped
Given a detached run whose task waits until it is stopped
When the stop command targets it
Then the run ends as interrupted and leaves no lock behind

### Scenario: a flag before the run folder does not take the folder as its value
Given a finished run folder
When the report and watch commands get --json before the folder
Then both read that folder and print its summary as JSON
