<?php
// GET : visiteur identifié ({pseudo, genre, admin}) ou null.
require __DIR__ . '/_cami.php';

repondre(['ok' => true, 'user' => user_public(user_courant())]);
