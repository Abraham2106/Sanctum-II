export interface Skill {
  id: string;
  name: string;
  description: string;
  tools: string[];
  model?: string;
  instructions: string;
}
