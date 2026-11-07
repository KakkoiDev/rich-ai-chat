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

### Scenario: only one runner works in a report folder and a stale lock is reclaimed
Given a report folder locked by a running process
When a second runner starts there, and later a runner starts after the locking process has exited
Then the second runner refuses with the locking PID, and the later runner reclaims the stale lock and finishes

### Scenario: an interrupted run resumes from its checkpoints without repeating finished tasks
Given a run interrupted by SIGINT while a task is in progress
When the run is resumed in the same folder
Then the state was interrupted with exit code 130, and the resumed run executes only the unfinished tasks and finishes

### Scenario: a resume refuses when a frozen file changed
Given an interrupted run whose manifest froze a source file
When that file is edited and the run is resumed
Then the runner refuses, naming the changed file, and runs no task

### Scenario: a finished report folder is never reused
Given a folder holding a finished run
When a new run or a resume targets that folder
Then the runner refuses and the finished reports are unchanged

### Scenario: a secret written into a report fails the run
Given a plan whose task writes a configured secret value into its report
When the runner finishes
Then the state is secret-leak, the scan names the file but not the value, and the exit code is 2

### Scenario: a win-rate run reports its score with a confidence interval
Given a match plan of independent games with wins, losses and draws, and a threshold of 0.51
When the runner finishes
Then the summary has the score and its Wilson interval, and the state is above-threshold only when the lower bound clears the threshold

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
