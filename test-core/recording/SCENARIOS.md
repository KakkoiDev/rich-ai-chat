# Recorder primitive scenarios

### Scenario: a recording captures actions without typed text or secret fields and stops cleanly
Given a page with a note input, a password input and a Save button
When I type into both fields, press Save and stop recording
Then actions and redacted lengths are delivered, secret fields are omitted and later input is not recorded

### Scenario: recording off and failed delivery do not break the application or retain typed values
Given a recorder that starts disabled and whose delivery callback fails
When I interact, enable recording and interact again
Then disabled interactions are omitted and failed delivery does not break the application

### Scenario: slow delivery keeps only the bounded recent steps and disabling drops pending steps
Given a recorder with a three-step pending queue and a stalled delivery
When I perform thirty actions, release delivery and disable recording
Then only the three most recent pending steps are sent and disabled pending steps are discarded

### Scenario: focus transitions, canvas clicks and real key releases are captured without secret targets
Given an enabled recorder on a page with ordinary and password inputs, a canvas and a button
When I move focus with Tab, release keys and click the canvas
Then only safe structural focus transitions, actual key events and the canvas click are captured, and disabling stops capture
