# Mechanics sheet

The numbers that shape how the game plays, in the format Craft Anything reads
(`mechanics.json` holds the same values). This is an original game: there is no original to
source values from, so every value is a design estimate and is marked `estimated`.

| Group | Name | Value | Unit |
|---|---|---|---|
| movement | walk speed | 1.7 | m/s |
| movement | run speed | 4.3 | m/s |
| movement | sprint speed | 7.2 | m/s |
| movement | crouch speed | 1.5 | m/s |
| movement | jump launch speed | 5.2 | m/s |
| movement | gravity on the player | 16 | m/s^2 |
| movement | sprint stamina | 22 | s |
| camera | camera distance on foot | 4.2 | m |
| camera | field of view | 60 | degrees |
| core | simulation rate | 60 | Hz |
| world | streaming cell size | 200 | m |
| world | streaming look-ahead | 3.5 | s |
| world | day length | 48 | real minutes |
| vehicles | wet road grip | 0.68 | multiplier |
| vehicles | sedan top speed | 46 | m/s |
| vehicles | sports car top speed | 68 | m/s |
| vehicles | truck top speed | 31 | m/s |
| vehicles | exit vehicle below | 7 | m/s |
| police | wanted thresholds (heat) | 1, 3, 6, 10, 15 |  |
| police | search patience | 18 s + 9 s per star |  |
| police | arrest hold time | 2.5 | s |
| economy | starting cash | 400 | $ |
| controls | enter vehicle | F |  |
| controls | interact | E |  |
| controls | sprint | Shift (hold) |  |

Vehicle handling for every class is in `data/vehicles/vehicles.json`.
