/**
 * Track E2a: a realistic library for the "Similar in your library" tests: 34 well-known games with their Steam
 * community tags in Steam's own order (strongest first, as `tags.library` returns them), trimmed to 15. Test data
 * only; nothing here ships in the app.
 */
import type { Game, LibraryTags } from '../bridge/types';

/** Title → Steam tags, strongest first. */
export const FORZA_LIBRARY: Record<string, string[]> = {
  'Forza Horizon 4': ['Racing', 'Open World', 'Driving', 'Multiplayer', 'Automobile Sim', 'Sports', 'Singleplayer', 'Adventure', 'Beautiful', 'Co-op', 'Action', 'Simulation', 'Realistic', 'Great Soundtrack', 'Online Co-Op'],
  'Forza Horizon 5': ['Racing', 'Open World', 'Driving', 'Multiplayer', 'Automobile Sim', 'Adventure', 'Sports', 'Singleplayer', 'Beautiful', 'Action', 'Co-op', 'Simulation', 'Realistic', 'Online Co-Op', 'Great Soundtrack'],
  'Need for Speed Heat': ['Racing', 'Open World', 'Driving', 'Action', 'Multiplayer', 'Automobile Sim', 'Singleplayer', 'Adventure', 'Arcade', 'Sports', 'Great Soundtrack', 'Atmospheric', 'Third Person', 'Online Co-Op', 'Beautiful'],
  'DiRT Rally 2.0': ['Racing', 'Simulation', 'Driving', 'Automobile Sim', 'Sports', 'Realistic', 'Multiplayer', 'Singleplayer', 'Offroad', 'Atmospheric', 'Physics', 'Difficult', 'VR', 'First-Person', 'Beautiful'],
  'Assetto Corsa': ['Racing', 'Simulation', 'Driving', 'Automobile Sim', 'Realistic', 'Sports', 'Multiplayer', 'Singleplayer', 'Moddable', 'VR', 'Physics', 'First-Person', 'Atmospheric', 'Competitive', 'Difficult'],
  'The Crew 2': ['Racing', 'Open World', 'Driving', 'Multiplayer', 'Automobile Sim', 'Action', 'Sports', 'Simulation', 'Adventure', 'Co-op', 'Flight', 'Singleplayer', 'Online Co-Op', 'Arcade', 'Third Person'],
  'BeamNG.drive': ['Simulation', 'Driving', 'Physics', 'Sandbox', 'Automobile Sim', 'Realistic', 'Destruction', 'Open World', 'Early Access', 'Racing', 'Singleplayer', 'Moddable', 'Multiplayer', 'Indie', 'Offroad'],
  'Euro Truck Simulator 2': ['Simulation', 'Driving', 'Automobile Sim', 'Open World', 'Realistic', 'Singleplayer', 'Relaxing', 'Moddable', 'Multiplayer', 'Economy', 'Management', 'Atmospheric', 'Exploration', 'First-Person', 'Sandbox'],
  'Rocket League': ['Multiplayer', 'Sports', 'Racing', 'Soccer', 'Competitive', 'Team-Based', 'Driving', 'Online Co-Op', 'Fast-Paced', 'Football (Soccer)', 'Co-op', 'Action', 'Funny', 'Local Multiplayer', 'Physics'],
  'Blair Witch': ['Horror', 'Psychological Horror', 'Adventure', 'Atmospheric', 'Singleplayer', 'First-Person', 'Story Rich', 'Survival Horror', 'Walking Simulator', 'Exploration', 'Action', 'Mystery', 'Dark', 'Open World', 'Multiple Endings'],
  'Outlast': ['Horror', 'Survival Horror', 'First-Person', 'Gore', 'Psychological Horror', 'Atmospheric', 'Singleplayer', 'Adventure', 'Stealth', 'Survival', 'Story Rich', 'Action', 'Dark', 'Violent', 'Mature'],
  'The Witcher 3: Wild Hunt': ['Open World', 'RPG', 'Story Rich', 'Atmospheric', 'Mature', 'Fantasy', 'Adventure', 'Choices Matter', 'Singleplayer', 'Great Soundtrack', 'Action', 'Third Person', 'Dark Fantasy', 'Magic', 'Multiple Endings'],
  'Grand Theft Auto V': ['Open World', 'Action', 'Multiplayer', 'Third Person', 'First-Person', 'Crime', 'Adventure', 'Shooter', 'Singleplayer', 'Mature', 'Racing', 'Driving', 'Funny', 'Sandbox', 'Atmospheric'],
  'Red Dead Redemption 2': ['Open World', 'Story Rich', 'Western', 'Adventure', 'Multiplayer', 'Action', 'Realistic', 'Shooter', 'Third Person', 'Singleplayer', 'Atmospheric', 'Beautiful', 'Mature', 'Hunting', 'Great Soundtrack'],
  'Firewatch': ['Walking Simulator', 'Adventure', 'Story Rich', 'Atmospheric', 'Exploration', 'Singleplayer', 'First-Person', 'Mystery', 'Indie', 'Great Soundtrack', 'Beautiful', 'Relaxing', 'Short', 'Open World', 'Nature'],
  'Hollow Knight': ['Metroidvania', 'Souls-like', 'Platformer', 'Difficult', 'Atmospheric', 'Great Soundtrack', '2D', 'Indie', 'Exploration', 'Action', 'Adventure', 'Hand-drawn', 'Singleplayer', 'Dark Fantasy', 'Story Rich'],
  'Stardew Valley': ['Farming Sim', 'Life Sim', 'Pixel Graphics', 'Multiplayer', 'Relaxing', 'Cute', 'RPG', 'Indie', 'Simulation', 'Co-op', 'Sandbox', 'Crafting', 'Singleplayer', 'Casual', '2D'],
  'Portal 2': ['Puzzle', 'Co-op', 'First-Person', 'Sci-fi', 'Comedy', 'Singleplayer', 'Adventure', 'Online Co-Op', 'Funny', 'Great Soundtrack', 'Story Rich', 'Action', 'Atmospheric', 'Physics', 'Multiplayer'],
  'Celeste': ['Precision Platformer', 'Difficult', 'Pixel Graphics', '2D', 'Platformer', 'Great Soundtrack', 'Indie', 'Singleplayer', 'Story Rich', 'Female Protagonist', 'Cute', 'Atmospheric', 'Adventure', 'Retro', 'Colorful'],
  'Hades': ['Action Roguelike', 'Roguelike', 'Mythology', 'Hack and Slash', 'Indie', 'Great Soundtrack', 'Action', 'Isometric', 'Roguelite', 'Story Rich', 'Difficult', 'Singleplayer', 'Fantasy', 'RPG', 'Replay Value'],
  'ELDEN RING': ['Souls-like', 'Dark Fantasy', 'Open World', 'RPG', 'Difficult', 'Action', 'Fantasy', 'Atmospheric', 'Multiplayer', 'Third Person', 'Exploration', 'Singleplayer', 'Great Soundtrack', 'Adventure', 'Co-op'],
  'The Elder Scrolls V: Skyrim Special Edition': ['Open World', 'RPG', 'Fantasy', 'Adventure', 'Moddable', 'Singleplayer', 'First-Person', 'Exploration', 'Atmospheric', 'Character Customization', 'Third Person', 'Action', 'Great Soundtrack', 'Story Rich', 'Magic'],
  'Cyberpunk 2077': ['Cyberpunk', 'Open World', 'RPG', 'Sci-fi', 'Singleplayer', 'Futuristic', 'Story Rich', 'Atmospheric', 'Action', 'Mature', 'Shooter', 'First-Person', 'Adventure', 'Character Customization', 'FPS'],
  'Subnautica': ['Open World Survival Craft', 'Survival', 'Underwater', 'Open World', 'Exploration', 'Crafting', 'Adventure', 'Base Building', 'Singleplayer', 'Atmospheric', 'Sci-fi', 'Building', 'First-Person', 'Story Rich', 'Indie'],
  'Disco Elysium': ['RPG', 'Detective', 'Story Rich', 'Choices Matter', 'Isometric', 'Investigation', 'Great Soundtrack', 'Atmospheric', 'Singleplayer', 'Mystery', 'Philosophical', 'Psychological', 'Crime', 'Dark Humor', 'Indie'],
  'DOOM Eternal': ['FPS', 'Action', 'Gore', 'Shooter', 'Great Soundtrack', 'Fast-Paced', 'Demons', 'Singleplayer', 'First-Person', 'Sci-fi', 'Violent', 'Difficult', 'Multiplayer', 'Arena Shooter', 'Atmospheric'],
  'Tomb Raider': ['Action', 'Adventure', 'Female Protagonist', 'Third Person', 'Exploration', 'Singleplayer', 'Atmospheric', 'Story Rich', 'Shooter', 'Survival', 'Open World', 'Platformer', 'Puzzle', 'Stealth', 'Great Soundtrack'],
  "Assassin's Creed Odyssey": ['Open World', 'RPG', 'Action', 'Adventure', 'Historical', 'Singleplayer', 'Exploration', 'Third Person', 'Choices Matter', 'Stealth', 'Story Rich', 'Female Protagonist', 'Atmospheric', 'Beautiful', 'Action RPG'],
  'Life is Strange': ['Story Rich', 'Choices Matter', 'Female Protagonist', 'Adventure', 'Atmospheric', 'Episodic', 'Singleplayer', 'Time Manipulation', 'Great Soundtrack', 'Emotional', 'Mystery', 'Drama', 'Multiple Endings', 'Third Person', 'Beautiful'],
  'Cities: Skylines': ['City Builder', 'Simulation', 'Building', 'Management', 'Strategy', 'Sandbox', 'Singleplayer', 'Moddable', 'Economy', 'Relaxing', 'Resource Management', 'Realistic', 'Casual', 'Indie', 'Great Soundtrack'],
  "Sid Meier's Civilization VI": ['Strategy', 'Turn-Based Strategy', '4X', 'Multiplayer', 'Historical', 'Turn-Based', 'Singleplayer', 'Grand Strategy', 'Simulation', 'Diplomacy', 'Replay Value', 'Moddable', 'Economy', 'Atmospheric', 'Tactical'],
  'Halo: The Master Chief Collection': ['FPS', 'Action', 'Shooter', 'Multiplayer', 'Sci-fi', 'Classic', 'Co-op', 'First-Person', 'Singleplayer', 'Story Rich', 'Online Co-Op', 'Space', 'Great Soundtrack', 'Adventure', 'Atmospheric'],
  'Ori and the Will of the Wisps': ['Metroidvania', 'Platformer', 'Beautiful', 'Great Soundtrack', 'Adventure', 'Atmospheric', 'Story Rich', 'Singleplayer', '2D', 'Action', 'Emotional', 'Exploration', 'Difficult', 'Fantasy', 'Colorful'],
  'Uncharted: Legacy of Thieves Collection': ['Action', 'Adventure', 'Third Person', 'Story Rich', 'Shooter', 'Singleplayer', 'Cinematic', 'Third-Person Shooter', 'Exploration', 'Puzzle', 'Atmospheric', 'Platformer', 'Beautiful', 'Stealth', 'Great Soundtrack'],
};

/** The racing and driving games in the fixture (besides Forza Horizon 4 itself). */
export const RACERS = ['Forza Horizon 5', 'Need for Speed Heat', 'DiRT Rally 2.0', 'Assetto Corsa', 'The Crew 2', 'BeamNG.drive', 'Euro Truck Simulator 2'];

/**
 * Builds the library: every game owned and tagged; `makeGame` turns a title into a Game. Blair Witch and the other
 * non-racers are never played (which lifts forgotten games), the racers were played recently (which lowers them),
 * so the test shows tags winning over both nudges.
 */
export function forzaFixture(makeGame: (title: string, i: number) => Game): { games: Game[]; tags: LibraryTags } {
  const names = [...new Set(Object.values(FORZA_LIBRARY).flat())];
  const idOf = new Map(names.map((n, i) => [n, 1000 + i]));
  const games = Object.keys(FORZA_LIBRARY).map((title, i) => makeGame(title, i));
  const map: Record<string, number[]> = {};
  const counts = new Map<number, number>();
  for (const g of games) {
    const ids = FORZA_LIBRARY[g.title].map((n) => idOf.get(n)!);
    map[g.id] = ids;
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const tags = names.map((name) => ({ id: idOf.get(name)!, name, count: counts.get(idOf.get(name)!) ?? 0 })).sort((a, b) => b.count - a.count);
  return { games, tags: { status: 'ok', message: null, tags, games: map, covered: games.length, steamGames: games.length, refreshing: false, fetchedAt: null } };
}
