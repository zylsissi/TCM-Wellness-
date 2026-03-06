/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum PainIntensity {
  LOW = "Low",
  MEDIUM = "Medium",
  HIGH = "High",
}

export interface PainRecord {
  id: string;
  date: string;
  location: string;
  intensity: PainIntensity;
  description: string;
}

export interface MedicalReport {
  id: string;
  name: string;
  uploadDate: string;
  type: 'image' | 'pdf' | 'other';
  content?: string; // Base64 data or extracted text
}

export interface TCMAnalysis {
  constitutionType: string;
  characteristics: string[];
  painAnalysis: string;
  dietaryAdvice: string[];
  lifestyleAdvice: string[];
  herbalSuggestions: string;
}
