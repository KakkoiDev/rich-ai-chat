# Slingshot recipe

For a self-contained HTML preview, start from the playable slingshot document. Keep the bird parked until release, convert pointer coordinates into canvas coordinates, and use the same geometry for drawing and collisions. Use fixed time steps, limit the pull, and give keyboard players aim and launch controls. Keep score, remaining shots, and restart visible outside the canvas. Change one mechanic at a time.

This dependency-free example is for the chat's isolated preview; normal Gaming Core game projects should use the pinned LittleJS starter and input layer.

## Scenarios

### Launch, hit and restart
Given a fresh game on a narrow screen
When the player launches with Space or drags the bird back and releases
Then a hit increments the score and consumes one shot, and Restart restores zero points and five shots.
