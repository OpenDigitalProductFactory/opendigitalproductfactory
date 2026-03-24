import { healthcareWellnessArchetypes } from "./healthcare-wellness";
import { beautyPersonalCareArchetypes } from "./beauty-personal-care";
import { tradesMaintenanceArchetypes } from "./trades-maintenance";
import { professionalServicesArchetypes } from "./professional-services";
import { educationTrainingArchetypes } from "./education-training";
import { petServicesArchetypes } from "./pet-services";
import { foodHospitalityArchetypes } from "./food-hospitality";
import { retailGoodsArchetypes } from "./retail-goods";
import { fitnessRecreationArchetypes } from "./fitness-recreation";
import { nonprofitCommunityArchetypes } from "./nonprofit-community";
import { hoaPropertyManagementArchetypes } from "./hoa-property-management";

export const ALL_ARCHETYPES = [
  ...healthcareWellnessArchetypes,
  ...beautyPersonalCareArchetypes,
  ...tradesMaintenanceArchetypes,
  ...professionalServicesArchetypes,
  ...educationTrainingArchetypes,
  ...petServicesArchetypes,
  ...foodHospitalityArchetypes,
  ...retailGoodsArchetypes,
  ...fitnessRecreationArchetypes,
  ...nonprofitCommunityArchetypes,
  ...hoaPropertyManagementArchetypes,
];
