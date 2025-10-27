#!/usr/bin/env python3
"""
SustainaDev CO2 & Energy Estimation
Enhanced version with comprehensive carbon footprint calculations
"""

from codecarbon import EmissionsTracker
import json
import sys

def estimate_energy_and_emissions(delta_ccn):
    """
    Estimates energy consumption and CO2 emissions based on complexity reduction.
    
    Args:
        delta_ccn (float): The reduction in cyclomatic complexity (CCN)
    
    Returns:
        dict: Contains emissions_kg, estimated_kwh_saved, estimated_cost_saved_usd,
              and additional environmental metrics
    """
    
    # Initialize emissions tracker (CodeCarbon)
    tracker = EmissionsTracker(
        save_to_file=False,
        logging_logger=None,  # Suppress logging
        log_level='error'
    )
    
    try:
        tracker.start()
        
        # Simulate computational workload
        # More iterations = more realistic energy measurement
        for _ in range(2_000_000):
            pass
        
        emissions_kg = tracker.stop() or 0.0
        
    except Exception as e:
        print(json.dumps({"error": f"Tracker failed: {str(e)}"}), file=sys.stderr)
        emissions_kg = 0.0
    
    # ========================================
    # Energy Estimation Based on CCN Reduction
    # ========================================
    
    # Rough correlation: Each CCN point reduced saves ~0.00001 kWh
    # This is a conservative estimate based on:
    # - Reduced CPU cycles for simpler code paths
    # - Less branching = better CPU pipeline efficiency
    # - Potential for compiler optimizations
    
    kwh_per_ccn_point = 0.00001
    estimated_kwh_saved = max(delta_ccn * kwh_per_ccn_point, 0)
    
    # ========================================
    # Cost Calculations
    # ========================================
    
    # Average electricity cost in USD per kWh
    # Global average: ~$0.15/kWh (varies by region)
    cost_per_kwh = 0.15
    estimated_cost_saved_usd = estimated_kwh_saved * cost_per_kwh
    
    # ========================================
    # Additional CO2 Calculations
    # ========================================
    
    # Average CO2 emissions per kWh (global grid mix)
    # World average: ~0.475 kg CO2/kWh
    co2_per_kwh = 0.475
    estimated_co2_saved_kg = estimated_kwh_saved * co2_per_kwh
    
    # Combine actual measured emissions with estimated savings
    total_co2_impact = emissions_kg + estimated_co2_saved_kg
    
    # ========================================
    # Environmental Impact Equivalents
    # ========================================
    
    # Trees needed to offset (1 tree absorbs ~21 kg CO2/year)
    trees_equivalent = estimated_co2_saved_kg / 21.0
    
    # Miles not driven (passenger car: ~0.4 kg CO2/mile)
    miles_not_driven = estimated_co2_saved_kg / 0.4
    
    # Smartphone charges (charging a phone: ~0.008 kWh)
    smartphone_charges = estimated_kwh_saved / 0.008
    
    # Lightbulb hours (100W bulb: 0.1 kWh/hour)
    lightbulb_hours = estimated_kwh_saved / 0.1
    
    # ========================================
    # Return Comprehensive Data
    # ========================================
    
    result = {
        # Core metrics
        "emissions_kg": round(emissions_kg, 8),
        "estimated_kwh_saved": round(estimated_kwh_saved, 8),
        "estimated_co2_saved_kg": round(estimated_co2_saved_kg, 8),
        "total_co2_impact_kg": round(total_co2_impact, 8),
        "estimated_cost_saved_usd": round(estimated_cost_saved_usd, 6),
        
        # Input parameter
        "delta_ccn": delta_ccn,
        
        # Environmental equivalents
        "equivalents": {
            "trees_to_offset": round(trees_equivalent, 3),
            "miles_not_driven": round(miles_not_driven, 2),
            "smartphone_charges": round(smartphone_charges, 1),
            "lightbulb_hours_100w": round(lightbulb_hours, 2)
        },
        
        # Calculation metadata
        "metadata": {
            "cost_per_kwh_usd": cost_per_kwh,
            "co2_per_kwh_kg": co2_per_kwh,
            "kwh_per_ccn_point": kwh_per_ccn_point,
            "method": "CodeCarbon + CCN-based estimation"
        }
    }
    
    return result


def main():
    """Main entry point for the script."""
    
    # Get delta CCN from command line arguments
    if len(sys.argv) > 1:
        try:
            delta_ccn = float(sys.argv[1])
        except ValueError:
            print(json.dumps({"error": "Invalid delta_ccn value. Must be a number."}))
            sys.exit(1)
    else:
        delta_ccn = 10.0  # Default value for testing
    
    # Calculate estimates
    result = estimate_energy_and_emissions(delta_ccn)
    
    # Output as JSON
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()